"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, buscarTudo } from "../lib/supabase";
import { interpretar, textoParaLinhas } from "../lib/roadnet";
import { useUsuario } from "../components/Casca";
import { guardarDataTrabalho, useTempoReal } from "../lib/hooks";
import { useColunas } from "../lib/colunas";
import { desfazerFrete } from "../lib/frete";
import VeiculosDisponiveis from "../components/VeiculosDisponiveis";
import {
  hojeISO, somarDias, fmtData, num, moeda, pct, zonaDaDescricao, entregadorDoRoadnet, corTrans,
} from "../lib/util";

export default function Programacao() {
  const router = useRouter();
  const { email } = useUsuario();
  const [rotas, setRotas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [saidasDia, setSaidasDia] = useState([]); // saídas das datas que estão na programação
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
  const [verDisponiveis, setVerDisponiveis] = useState(false);

  // A Programação mostra SÓ a última base importada do RoadNet (igual para todo mundo).
  // Não guarda histórico: cada importação substitui a anterior.
  const loteAtual = useRef("");
  async function carregar() {
    const [todas, v] = await Promise.all([
      buscarTudo(() => sb().from("programacao").select("*").order("id")),
      buscarTudo(() => sb().from("veiculos").select("*").order("transportadora").order("placa")),
    ]);
    // garante que aparece apenas o último lote importado (mesmo que sobre algo antigo no banco)
    const ultimo = (todas || []).reduce((m, x) => (x.created_at > m ? x.created_at : m), "");
    const r = (todas || []).filter((x) => x.created_at === ultimo);
    const datas = [...new Set((r || []).map((x) => x.data))];
    const s = datas.length
      ? await sb().from("saidas").select("id,placa,status,data").in("data", datas)
      : { data: [] };
    setRotas(r || []);
    setVeiculos(v || []);
    setSaidasDia(s.data || []);
    // só limpa as marcações "Sai?" quando chega uma base nova
    const lote = r[0]?.created_at || "";
    if (lote !== loteAtual.current) { setExcluidas({}); setIncluidasSemCarga({}); loteAtual.current = lote; }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useTempoReal(carregar, []); // atualiza sozinho quando alguém importa ou gera frete

  const mapaVeic = useMemo(() => Object.fromEntries(veiculos.map((v) => [v.placa, v])), [veiculos]);

  // Linhas da programação: só os equipamentos que vieram do RoadNet (verde = com carga, laranja = sem carga)
  const linhas = useMemo(() => {
    const comRota = rotas.map((r) => {
      const v = mapaVeic[r.placa];
      return {
        chave: "r" + r.id,
        data: r.data,
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
    const ordenar = (a, b) => (a.transportadora || "zzz").localeCompare(b.transportadora || "zzz") || a.placa.localeCompare(b.placa);
    return comRota.sort((x, y) =>
      (x.data || "").localeCompare(y.data || "") ||
      (x.tipoLinha === y.tipoLinha ? ordenar(x, y) : x.tipoLinha === "carga" ? -1 : 1));
  }, [rotas, mapaVeic]);

  const [refTabela, ajustarColunas] = useColunas("programacao", `${carregando}-${linhas.length}-${mostrarSemCarga}`);

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

  // veículos que vão para o frete, por transportadora (segue o "Sai?" marcado)
  const porTrans = useMemo(() => {
    const m = new Map();
    for (const l of selecionadas) {
      const t = String(l.transportadora || "").trim().toUpperCase() || "SEM CADASTRO";
      const g = m.get(t) || { trans: t, qtd: 0, peso: 0, valor: 0 };
      g.qtd += 1; g.peso += Number(l.peso) || 0; g.valor += Number(l.valor) || 0;
      m.set(t, g);
    }
    const ordem = (g) => (g.trans.startsWith("HOK") ? 0 : 1);
    return [...m.values()].sort((a, b) => ordem(a) - ordem(b) || b.qtd - a.qtd || a.trans.localeCompare(b.trans));
  }, [selecionadas]);
  const datas = [...new Set(rotas.map((r) => r.data))].sort();
  const placasNaProgramacao = useMemo(() => new Set(rotas.map((r) => String(r.placa || "").trim().toUpperCase().replace(/[\s-]/g, ""))), [rotas]);
  const importadoEm = rotas.reduce((m, r) => (r.created_at > m ? r.created_at : m), "");
  const importadoPor = rotas.find((r) => r.created_at === importadoEm)?.created_by || "";
  const qtdProgramado = saidasDia.filter((s) => s.status === "PROGRAMADO").length;
  const qtdConfirmado = saidasDia.filter((s) => s.status !== "PROGRAMADO").length;

  // ---------- importação ----------
  function aplicarPrevia(res) {
    setPrevia(res);
    setDataImport(res.dataSugerida || hojeISO());
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

  // Salvar = substituir a programação inteira pela base nova (espelho do RoadNet)
  async function salvarProgramacao() {
    if (!previa?.rotas?.length || !dataImport) return;
    if (rotas.length && !confirm(`Substituir a programação atual (${rotas.length} rotas) pela nova base (${previa.rotas.length} rotas)?\n\nO frete e as saídas já geradas NÃO são apagados.`)) return;
    setSalvando(true);
    const del = await sb().from("programacao").delete().gte("id", 0);
    if (del.error) { setSalvando(false); return setMsg({ tipo: "erro", txt: del.error.message }); }
    // todas as rotas da base ficam com a mesma data de saída (a escolhida na importação)
    const linhasNovas = previa.rotas.map((r) => ({ ...r, data: dataImport, created_by: email }));
    const ins = await sb().from("programacao").insert(linhasNovas).select("created_at").limit(1);
    if (ins.error) { setSalvando(false); return setMsg({ tipo: "erro", txt: ins.error.message }); }
    // limpeza: apaga qualquer coisa mais antiga que tenha sobrado
    const marca = ins.data?.[0]?.created_at;
    if (marca) await sb().from("programacao").delete().lt("created_at", marca);
    setSalvando(false);
    setMsg({ tipo: "ok", txt: `Programação importada: ${previa.rotas.length} rotas (saída ${fmtData(dataImport)}).` });
    setTexto(""); setPrevia(null); setAbrirImport(false);
    carregar();
  }

  // ---------- gerar frete ----------
  async function gerarFrete() {
    if (!selecionadas.length) return;
    const porData = {};
    selecionadas.forEach((l) => { (porData[l.data] = porData[l.data] || []).push(l); });
    const datasFrete = Object.keys(porData).sort();
    const progExistente = saidasDia.filter((x) => x.status === "PROGRAMADO" && porData[x.data]).length;
    if (progExistente && !confirm(`Já existe frete para ${datasFrete.map(fmtData).join(", ")} com ${progExistente} veículo(s) ainda não saídos. Refazer o frete? (motoristas digitados nesses veículos serão perdidos)`)) return;

    for (const d of datasFrete) {
      const jaSairam = new Set(saidasDia.filter((x) => x.data === d && x.status !== "PROGRAMADO").map((x) => x.placa));
      const novas = porData[d]
        .filter((l) => !jaSairam.has(l.placa))
        .map((l, i) => {
          const v = mapaVeic[l.placa] || {};
          return {
            data: d,
            zona: zonaDaDescricao(l.destino),
            placa: l.placa,
            transportadora: v.transportadora || "",
            tipo: v.tipo || l.tipo || "",
            entregas: l.paradas,
            kg: l.peso,
            valor: l.valor,
            destino: l.destino || "",
            motorista: "",   // definidos depois pelo time de transporte
            entregador: "",
            status: "PROGRAMADO",
            ordem: i,
          };
        });
      const del = await sb().from("saidas").delete().eq("data", d).eq("status", "PROGRAMADO");
      if (del.error) return setMsg({ tipo: "erro", txt: del.error.message });
      if (novas.length) {
        const ins = await sb().from("saidas").insert(novas);
        if (ins.error) return setMsg({ tipo: "erro", txt: ins.error.message });
      }
    }
    guardarDataTrabalho(datasFrete[0]);
    router.push(`/frete?data=${datasFrete[0]}`);
  }

  async function desfazerTudo() {
    const comFrete = [...new Set(saidasDia.map((x) => x.data))].sort();
    let mudou = false;
    for (const d of comFrete) if (await desfazerFrete(d)) mudou = true;
    if (mudou) carregar();
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
        </div>
        <div className="acoes">
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
                  <label className="campo-data" title="Vem da Sessão de roteirização do RoadNet; pode trocar se precisar">Data de saída
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
          <small>livre {pct(1 - ocup)}</small>
        </div>
      </section>

      {porTrans.length > 0 && (
        <section className="por-trans">
          <span className="por-trans-tit">🚚 Indo para o frete <b>{selecionadas.length}</b></span>
          {porTrans.map((g) => (
            <span key={g.trans} className={`chip-trans ${corTrans(g.trans)}`}
              title={`${g.trans}: ${g.qtd} veículo(s) · ${num(g.peso)} kg · ${moeda(g.valor)}`}>
              {g.trans} <b>{g.qtd}</b>
            </span>
          ))}
        </section>
      )}

      {naoCadastradas.length > 0 && (
        <div className="alerta aviso">
          Placas roteirizadas que não estão no cadastro de veículos: {naoCadastradas.map((l) => (
            <Link key={l.chave} href={`/veiculos?nova=${l.placa}`} className="etiqueta">{l.placa} +</Link>
          ))}
        </div>
      )}

      {verDisponiveis && (
        <VeiculosDisponiveis
          placasNaProgramacao={placasNaProgramacao}
          dataRef={datas[0] || hojeISO()}
          cadastro={mapaVeic}
        />
      )}

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div>
            <b>{rotas.length} rotas</b>
            {datas.length > 0 && <> · saída {datas.map(fmtData).join(", ")}</>}
            {importadoEm && <span className="sub"> · importado em {new Date(importadoEm).toLocaleString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{importadoPor ? ` por ${importadoPor}` : ""}</span>}
            {qtdProgramado + qtdConfirmado > 0 && (
              <>
                <span className="etiqueta cinza">Frete gerado: {qtdProgramado} a sair · {qtdConfirmado} já saíram</span>
                <button className="btn link" onClick={desfazerTudo}>↩ desfazer frete</button>
              </>
            )}
          </div>
          <div className="linha-acoes">
            <button className={`btn ${verDisponiveis ? "ativo-azul" : ""}`} onClick={() => setVerDisponiveis((v) => !v)} title="Veículos que mais usamos e que estão livres (fora desta programação)">
              🚚 Veículos disponíveis {verDisponiveis ? "▲" : "▼"}
            </button>
            <button className="btn link" title="Volta as colunas para o auto ajuste" onClick={ajustarColunas}>↔ ajustar colunas</button>
            <label className="check"><input type="checkbox" checked={mostrarSemCarga} onChange={(e) => setMostrarSemCarga(e.target.checked)} /> mostrar sem carga</label>
            <button className="btn primario" disabled={!selecionadas.length} onClick={gerarFrete}>
              Gerar frete com {selecionadas.length} veículo(s) →
            </button>
          </div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : linhas.length === 0 ? (
          <div className="vazio">Nenhuma programação importada. Clique em <b>Colar do RoadNet</b>.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="prog" ref={refTabela} data-tabela="prog">
              <thead>
                <tr>
                  <th title="Entra no frete">Sai?</th><th>Data</th><th>Trans.</th><th>Equipam.</th><th>Tipo</th><th className="n">E</th>
                  <th className="n">KG</th><th className="n">Capac.</th><th className="n">%</th><th>Entregadores</th><th>Destino</th><th className="n">R.O.B</th>
                </tr>
              </thead>
              <tbody>
                {linhas.filter((l) => mostrarSemCarga || l.tipoLinha === "carga").map((l) => {
                  const reservado = /RESERVAD/i.test(l.destino || "");
                  return (
                    <tr key={l.chave} data-id={l.chave} className={`${l.tipoLinha === "carga" ? "l-verde" : "l-laranja"} ${reservado ? "l-reservado" : ""} ${vaiSair(l) ? "" : "l-fora"}`}>
                      <td>
                        <input type="checkbox" checked={vaiSair(l)} onChange={(e) => {
                          if (l.tipoLinha === "carga") setExcluidas({ ...excluidas, [l.chave]: !e.target.checked });
                          else setIncluidasSemCarga({ ...incluidasSemCarga, [l.chave]: e.target.checked });
                        }} />
                      </td>
                      <td className="c-data">{fmtData(l.data).slice(0, 5)}</td>
                      <td className={corTrans(l.transportadora)}>{l.transportadora || <span className="etiqueta aviso">sem cadastro</span>}</td>
                      <td className="placa">{l.placa}</td>
                      <td>{l.tipo}</td>
                      <td className="n">{l.paradas ?? ""}</td>
                      <td className="n">{num(l.peso)}</td>
                      <td className="n">{num(l.capacidade)}</td>
                      <td className="n">{l.ocupacao !== null ? <span className={l.ocupacao > 1 ? "t-vermelho" : ""}>{pct(l.ocupacao)}</span> : ""}</td>
                      <td>{l.entregador}</td>
                      <td>{l.destino}{l.tipoLinha !== "carga" && <b className="t-laranja"> · SEM CARGA</b>}</td>
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
