"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, buscarTudo } from "../lib/supabase";
import { interpretar, textoParaLinhas } from "../lib/roadnet";
import { useUsuario } from "../components/Casca";
import { lerDataTrabalho, guardarDataTrabalho } from "../lib/hooks";
import {
  hojeISO, somarDias, fmtData, num, moeda, pct, zonaDaDescricao, entregadorDoRoadnet,
} from "../lib/util";

export default function Programacao() {
  const router = useRouter();
  const { email } = useUsuario();
  const [data, setData] = useState(null);
  const [rotas, setRotas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [saidasDia, setSaidasDia] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [msg, setMsg] = useState(null);

  // importação
  const [abrirImport, setAbrirImport] = useState(false);
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState(null);
  const [dataImport, setDataImport] = useState("");
  const [salvando, setSalvando] = useState(false);

  // seleção para o frete (automática: quem tem carga)
  const [excluidas, setExcluidas] = useState({}); // chave -> true (desmarcada)
  const [incluidasSemCarga, setIncluidasSemCarga] = useState({}); // placa -> true
  const [mostrarSemCarga, setMostrarSemCarga] = useState(true);

  // data inicial = última data usada, senão a programação mais recente (ou hoje)
  useEffect(() => {
    (async () => {
      const guardada = lerDataTrabalho();
      if (guardada) return setData(guardada);
      const { data: ult } = await sb().from("programacao").select("data").order("data", { ascending: false }).limit(1);
      setData(ult?.[0]?.data || hojeISO());
    })();
  }, []);

  async function carregar(d = data) {
    if (!d) return;
    setCarregando(true);
    const [r, v, s] = await Promise.all([
      sb().from("programacao").select("*").eq("data", d).order("id"),
      buscarTudo(() => sb().from("veiculos").select("*").order("transportadora").order("placa")),
      sb().from("saidas").select("id,placa,status").eq("data", d),
    ]);
    setRotas(r.data || []);
    setVeiculos(v || []);
    setSaidasDia(s.data || []);
    setExcluidas({});
    setIncluidasSemCarga({});
    setCarregando(false);
  }
  useEffect(() => { guardarDataTrabalho(data); carregar(data); }, [data]);

  const mapaVeic = useMemo(() => Object.fromEntries(veiculos.map((v) => [v.placa, v])), [veiculos]);

  // Linhas da programação: rotas do RoadNet (verde) + frota fixa sem rota (laranja)
  const linhas = useMemo(() => {
    const comRota = rotas.map((r) => {
      const v = mapaVeic[r.placa];
      return {
        chave: "r" + r.id,
        tipoLinha: (r.paradas || 0) > 0 ? "carga" : "vazia",
        placa: r.placa,
        transportadora: v?.transportadora || "",
        tipo: v?.tipo || r.tipo_equip || "",
        cadastrada: Boolean(v),
        paradas: r.paradas,
        peso: r.peso,
        capacidade: r.capacidade,
        valor: r.valor,
        ocupacao: r.capacidade ? (r.peso || 0) / r.capacidade : null,
        entregador: entregadorDoRoadnet(r.trabalhadores),
        destino: r.descricao,
        rota: r,
      };
    });
    const placasComRota = new Set(rotas.map((r) => r.placa));
    const semRota = veiculos
      .filter((v) => v.ativo && !placasComRota.has(v.placa))
      .map((v) => ({
        chave: "v" + v.placa, tipoLinha: "semcarga", placa: v.placa, transportadora: v.transportadora,
        tipo: v.tipo, cadastrada: true, paradas: null, peso: null, capacidade: null, valor: null,
        ocupacao: null, entregador: "", destino: "", rota: null,
      }));
    const ordenar = (a, b) => (a.transportadora || "zzz").localeCompare(b.transportadora || "zzz") || a.placa.localeCompare(b.placa);
    return [...comRota.sort(ordenar), ...semRota.sort(ordenar)];
  }, [rotas, veiculos, mapaVeic]);

  const comCarga = linhas.filter((l) => l.tipoLinha === "carga");
  const semCarga = linhas.filter((l) => l.tipoLinha !== "carga");
  const naoCadastradas = linhas.filter((l) => !l.cadastrada);
  const pesoTotal = rotas.reduce((s, r) => s + (Number(r.peso) || 0), 0);
  const capTotal = rotas.reduce((s, r) => s + (Number(r.capacidade) || 0), 0);
  const valorTotal = rotas.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const ocup = capTotal ? pesoTotal / capTotal : 0;

  const vaiSair = (l) =>
    l.tipoLinha === "carga" ? !excluidas[l.chave] : Boolean(incluidasSemCarga[l.chave]);
  const selecionadas = linhas.filter(vaiSair);

  const qtdProgramado = saidasDia.filter((s) => s.status === "PROGRAMADO").length;
  const qtdConfirmado = saidasDia.filter((s) => s.status !== "PROGRAMADO").length;

  // ---------- importação ----------
  function aplicarPrevia(res) {
    setPrevia(res);
    setDataImport(res.dataSugerida || data || hojeISO());
  }
  function processarTexto(t = texto) {
    aplicarPrevia(interpretar(textoParaLinhas(t)));
  }

  async function lerArquivo(e) {
    const arq = e.target.files?.[0];
    if (!arq) return;
    const XLSX = await import("xlsx");
    const buf = await arq.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    aplicarPrevia(interpretar(matriz));
    e.target.value = "";
  }

  async function salvarProgramacao() {
    if (!previa?.rotas?.length || !dataImport) return;
    const { count } = await sb().from("programacao").select("id", { count: "exact", head: true }).eq("data", dataImport);
    if (count && !confirm(`Já existe programação para ${fmtData(dataImport)} (${count} rotas). Substituir pela nova?`)) return;
    setSalvando(true);
    const del = await sb().from("programacao").delete().eq("data", dataImport);
    if (del.error) { setSalvando(false); return setMsg({ tipo: "erro", txt: del.error.message }); }
    const ins = await sb().from("programacao").insert(previa.rotas.map((r) => ({ ...r, data: dataImport, created_by: email })));
    setSalvando(false);
    if (ins.error) return setMsg({ tipo: "erro", txt: ins.error.message });
    setMsg({ tipo: "ok", txt: `Programação de ${fmtData(dataImport)} salva: ${previa.rotas.length} rotas.` });
    setTexto(""); setPrevia(null); setAbrirImport(false);
    if (dataImport === data) carregar(dataImport); else setData(dataImport);
  }

  // ---------- gerar frete ----------
  async function gerarFrete() {
    if (!selecionadas.length) return;
    const jaSairam = new Set(saidasDia.filter((s) => s.status !== "PROGRAMADO").map((s) => s.placa));
    if (qtdProgramado && !confirm(`Já existe um frete de ${fmtData(data)} com ${qtdProgramado} veículo(s) ainda não saídos. Refazer o frete? (motoristas digitados nesses veículos serão perdidos)`)) return;

    // último motorista/entregador usado por placa (para pré-preencher)
    const hist = await sb().from("saidas").select("placa,motorista,entregador,data")
      .gte("data", somarDias(data, -120)).neq("status", "PROGRAMADO")
      .order("data", { ascending: false }).limit(3000);
    const ultimo = {};
    (hist.data || []).forEach((h) => {
      if (!ultimo[h.placa]) ultimo[h.placa] = { motorista: "", entregador: "" };
      if (!ultimo[h.placa].motorista && h.motorista) ultimo[h.placa].motorista = h.motorista;
      if (!ultimo[h.placa].entregador && h.entregador) ultimo[h.placa].entregador = h.entregador;
    });

    const novas = selecionadas
      .filter((l) => !jaSairam.has(l.placa))
      .map((l, i) => {
        const v = mapaVeic[l.placa] || {};
        return {
          data,
          zona: zonaDaDescricao(l.destino),
          placa: l.placa,
          transportadora: v.transportadora || "",
          tipo: v.tipo || l.tipo || "",
          entregas: l.paradas,
          kg: l.peso,
          valor: l.valor,
          destino: l.destino || "",
          motorista: v.motorista || ultimo[l.placa]?.motorista || "",
          entregador: l.entregador || v.entregador || ultimo[l.placa]?.entregador || "",
          status: "PROGRAMADO",
          ordem: i,
        };
      });

    const del = await sb().from("saidas").delete().eq("data", data).eq("status", "PROGRAMADO");
    if (del.error) return setMsg({ tipo: "erro", txt: del.error.message });
    if (novas.length) {
      const ins = await sb().from("saidas").insert(novas);
      if (ins.error) return setMsg({ tipo: "erro", txt: ins.error.message });
    }
    router.push(`/frete?data=${data}`);
  }

  if (!data) return <div className="carregando">Carregando…</div>;

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Planejamento de entregas — Roteirização AM</h1>
          <p className="sub">Cole a base do RoadNet. Placas com carga ficam <b className="t-verde">verdes</b>; frota fixa sem carga fica <b className="t-laranja">laranja</b>.</p>
        </div>
        <div className="acoes">
          <label className="campo-data">Data de saída
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <button className="btn" onClick={() => setAbrirImport(!abrirImport)}>{abrirImport ? "Fechar importação" : "Colar do RoadNet"}</button>
        </div>
      </div>

      {msg && <div className={`alerta ${msg.tipo}`} onClick={() => setMsg(null)}>{msg.txt}</div>}

      {abrirImport && (
        <section className="cartao">
          <h2>Importar base do RoadNet</h2>
          <p className="sub">No RoadNet, selecione as rotas na grade, <b>Ctrl+C</b> e cole abaixo (com ou sem o cabeçalho). Ou envie o arquivo exportado (.xlsx/.csv).</p>
          <textarea
            className="colar"
            placeholder="Cole aqui (Ctrl+V)…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) processarTexto(t); }}
          />
          <div className="linha-acoes">
            <button className="btn" onClick={() => processarTexto()} disabled={!texto.trim()}>Ler texto colado</button>
            <label className="btn arquivo">Enviar arquivo<input type="file" accept=".xlsx,.xls,.csv" onChange={lerArquivo} /></label>
          </div>

          {previa && (
            <div className="previa">
              {previa.avisos.map((a, i) => <div key={i} className="alerta aviso">{a}</div>)}
              <p><b>{previa.rotas.length}</b> rotas lidas · <b>{previa.rotas.filter((r) => (r.paradas || 0) > 0).length}</b> com carga · peso {num(previa.rotas.reduce((s, r) => s + (r.peso || 0), 0))} kg</p>
              {previa.rotas.length > 0 && (
                <div className="linha-acoes">
                  <label className="campo-data">Salvar como data de saída
                    <input type="date" value={dataImport} onChange={(e) => setDataImport(e.target.value)} />
                  </label>
                  <button className="btn primario" onClick={salvarProgramacao} disabled={salvando || !dataImport}>
                    {salvando ? "Salvando…" : "Salvar programação"}
                  </button>
                </div>
              )}
              <div className="tabela-rolagem mini">
                <table>
                  <thead><tr><th>Rota</th><th>Descrição</th><th>Placa</th><th className="n">Paradas</th><th className="n">Peso</th><th className="n">Valor</th><th>Trabalhadores</th></tr></thead>
                  <tbody>
                    {previa.rotas.slice(0, 60).map((r, i) => (
                      <tr key={i}><td>{r.rota_id}</td><td>{r.descricao}</td><td>{r.placa}</td><td className="n">{r.paradas}</td><td className="n">{num(r.peso)}</td><td className="n">{moeda(r.valor)}</td><td>{r.trabalhadores}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="kpis">
        <div className="kpi verde"><span>Com carga</span><b>{comCarga.length}</b></div>
        <div className="kpi laranja"><span>Sem carga</span><b>{semCarga.length}</b></div>
        <div className="kpi"><span>Peso total</span><b>{num(pesoTotal)} kg</b></div>
        <div className="kpi"><span>Valor (R.O.B)</span><b>{moeda(valorTotal)}</b></div>
        <div className="kpi">
          <span>Ocupação da frota</span>
          <b>{pct(ocup)}</b>
          <div className="barra"><i style={{ width: `${Math.min(ocup, 1) * 100}%` }} /></div>
          <small>Carga {pct(ocup)} · Livre {pct(1 - ocup)}</small>
        </div>
      </section>

      {naoCadastradas.length > 0 && (
        <div className="alerta aviso">
          Placas roteirizadas que não estão no cadastro de veículos: {naoCadastradas.map((l) => (
            <Link key={l.chave} href={`/veiculos?nova=${l.placa}`} className="etiqueta">{l.placa} +</Link>
          ))}
        </div>
      )}

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div>
            <b>{fmtData(data)}</b> · {rotas.length} rotas
            {qtdProgramado + qtdConfirmado > 0 && (
              <span className="etiqueta cinza">Frete gerado: {qtdProgramado} a sair · {qtdConfirmado} já saíram</span>
            )}
          </div>
          <div className="linha-acoes">
            <label className="check"><input type="checkbox" checked={mostrarSemCarga} onChange={(e) => setMostrarSemCarga(e.target.checked)} /> mostrar sem carga</label>
            <button className="btn primario" disabled={!selecionadas.length} onClick={gerarFrete}>
              Gerar frete com {selecionadas.length} veículo(s) →
            </button>
          </div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : linhas.length === 0 ? (
          <div className="vazio">Nenhuma programação para {fmtData(data)}. Clique em <b>Colar do RoadNet</b>.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="prog">
              <thead>
                <tr>
                  <th title="Entra no frete">Sai?</th><th>Trans.</th><th>Equipam.</th><th>Tipo</th><th className="n">E</th>
                  <th className="n">KG</th><th className="n">Capac.</th><th className="n">%</th><th>Entregadores</th><th>Destino</th><th className="n">R.O.B</th>
                </tr>
              </thead>
              <tbody>
                {linhas.filter((l) => mostrarSemCarga || l.tipoLinha === "carga").map((l) => {
                  const reservado = /RESERVAD/i.test(l.destino || "");
                  return (
                    <tr key={l.chave} className={`${l.tipoLinha === "carga" ? "l-verde" : "l-laranja"} ${reservado ? "l-reservado" : ""} ${vaiSair(l) ? "" : "l-fora"}`}>
                      <td>
                        <input type="checkbox" checked={vaiSair(l)} onChange={(e) => {
                          if (l.tipoLinha === "carga") setExcluidas({ ...excluidas, [l.chave]: !e.target.checked });
                          else setIncluidasSemCarga({ ...incluidasSemCarga, [l.chave]: e.target.checked });
                        }} />
                      </td>
                      <td>{l.transportadora || <span className="etiqueta aviso">sem cadastro</span>}</td>
                      <td className="placa">{l.placa}</td>
                      <td>{l.tipo}</td>
                      <td className="n">{l.paradas ?? ""}</td>
                      <td className="n">{num(l.peso)}</td>
                      <td className="n">{num(l.capacidade)}</td>
                      <td className="n">{l.ocupacao !== null ? <span className={l.ocupacao > 1 ? "t-vermelho" : ""}>{pct(l.ocupacao)}</span> : ""}</td>
                      <td>{l.entregador}</td>
                      <td>{l.destino || (l.tipoLinha === "semcarga" ? "SEM CARGA" : "")}</td>
                      <td className="n">{moeda(l.valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
