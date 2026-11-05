"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import { useTempoReal } from "../../lib/hooks";
import { useUsuario } from "../../components/Casca";
import { hojeISO, somarDias, fmtData, fmtDataHora, num, moeda, baixarCSV, normPlaca, lerNumeroBR } from "../../lib/util";
import ComboBairro from "../../components/ComboBairro";
import { BAIRROS_MANAUS } from "../../lib/bairros";
import { lerColagem, nomesDoFrete, somar, buscarNaRoad, completarComRoad, PLACAS_FICTICIAS, CLIENTE_PADRAO } from "../../lib/notasAgendadas";

// Notas agendadas: notas fiscais de agendamento (ex.: J A GOMES) faturadas em placa fictícia.
// 1) Adiciona as notas (digitando ou colando) -> ficam PENDENTES.
// 2) Marca as notas, informa a nova placa e a data de saída -> ROTEIRIZADO.
//    Motorista e entregador vêm do frete (Frete / Saídas) da nova placa nesse dia.

const dm = (iso) => (iso ? fmtData(iso).slice(0, 5) : "—");
const diasDesde = (iso, hoje) => (iso ? Math.max(0, Math.round((Date.parse(hoje + "T12:00:00Z") - Date.parse(iso + "T12:00:00Z")) / 86400000)) : null);
const br = (n) => (n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ","));
const VAZIA = { numnota: "", numped: "", valor: "", peso: "", carregamento: "", obs: "", cliente: "", codcli: "", destino: "", placa_road: "" };

export default function NotasAgendadas() {
  const { email } = useUsuario();
  const hoje = hojeISO();
  const [pend, setPend] = useState([]);
  const [rote, setRote] = useState([]);
  const [placasCad, setPlacasCad] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [semTabela, setSemTabela] = useState(false);
  const [msg, setMsg] = useState(null);
  const [de, setDe] = useState(somarDias(hoje, -7));
  const [ate, setAte] = useState(somarDias(hoje, 7));

  async function carregar() {
    try {
      const [p, r, v] = await Promise.all([
        buscarTudo(() => sb().from("notas_agendadas").select("*").eq("status", "PENDENTE").order("dt_registro").order("numnota")),
        buscarTudo(() => sb().from("notas_agendadas").select("*").eq("status", "ROTEIRIZADO").gte("dt_saida", de).lte("dt_saida", ate).order("dt_saida", { ascending: false }).order("placa")),
        sb().from("veiculos").select("placa, transportadora, tipo").order("placa"),
      ]);
      setPend(p); setRote(r); setPlacasCad(v.data || []); setSemTabela(false);
    } catch (e) {
      setSemTabela(/notas_agendadas|relation|schema cache/i.test(e?.message || ""));
      if (!/notas_agendadas|relation|schema cache/i.test(e?.message || "")) setMsg({ tipo: "erro", txt: e.message });
    }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, [de, ate]);
  useTempoReal(carregar, [de, ate]);


  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Notas agendadas <small className="sub">placa fictícia → placa de verdade</small></h1>
      </div>

      {semTabela && <div className="alerta aviso">Rode o arquivo <b>18_notas_agendadas.sql</b> no Supabase (SQL Editor › Run) para ativar esta aba.</div>}
      {msg && <div className={`alerta ${msg.tipo}`} onClick={() => setMsg(null)}>{msg.txt}</div>}

      <Adicionar email={email} hoje={hoje} existentes={new Set([...pend, ...rote].map((n) => n.numnota))} clientes={[...new Set([...pend, ...rote].map((n) => n.cliente).filter(Boolean))]}
        aoAdicionar={(t) => { setMsg({ tipo: "ok", txt: t }); carregar(); }} aoErro={(t) => setMsg({ tipo: "erro", txt: t })} />

      <Pendentes pend={pend} hoje={hoje} email={email} placasCad={placasCad} carregando={carregando}
        aviso={(tipo, txt) => setMsg({ tipo, txt })} recarregar={carregar} />

      <Roteirizadas rote={rote} de={de} ate={ate} setDe={setDe} setAte={setAte} hoje={hoje}
        aviso={(tipo, txt) => setMsg({ tipo, txt })} recarregar={carregar} />
    </>
  );
}

// ---------------- adicionar notas ----------------
function Adicionar({ email, hoje, existentes, clientes, aoAdicionar, aoErro }) {
  const [aberto, setAberto] = useState(true);
  const [modo, setModo] = useState("UMA");
  const cliente = CLIENTE_PADRAO, placaF = PLACAS_FICTICIAS[0], destino = "AGEN JA"; // quando a nota não está na ROAD
  const [bairro, setBairro] = useState("");             // digitar: bairro da nota
  const [bairroTodas, setBairroTodas] = useState("");   // colar: bairro para todas
  const [bairros, setBairros] = useState({});           // colar: bairro de cada nota (troca o de todas)
  const [nota, setNota] = useState(VAZIA);
  const [busca, setBusca] = useState({ nf: "", estado: "" }); // estado: buscando | achou | nao | erro
  const [texto, setTexto] = useState("");
  const [road, setRoad] = useState({ chave: "", achadas: {}, faltando: [], estado: "" });
  const [salvando, setSalvando] = useState(false);

  const padrao = { cliente: cliente.toUpperCase().trim(), placa_ficticia: normPlaca(placaF) || PLACAS_FICTICIAS[0], destino: destino.toUpperCase().trim() };
  const leitura = useMemo(() => (texto.trim() ? lerColagem(texto, padrao) : null), [texto]);
  // notas coladas + o que veio da ROAD (o que foi colado tem prioridade; a ROAD completa o que faltar)
  const coladas = (leitura?.notas || []).map((n) => ({ ...completarComRoad(n, road.achadas[n.numnota], padrao), bairro: bairros[n.numnota] || n.bairro || bairroTodas }));
  const novas = coladas.filter((n) => !existentes.has(n.numnota));
  const repetidas = coladas.length - novas.length;
  const semBairro = novas.filter((n) => !n.bairro).length;
  const nfDigitada = String(nota.numnota).replace(/\D/g, "");

  // ---- digitando: busca a nota na ROAD (ao parar de digitar, ao sair do campo ou no Enter) ----
  async function buscarUma(nf) {
    if (!nf || nf.length < 4) return null;
    setBusca({ nf, estado: "buscando" });
    try {
      const r = await buscarNaRoad([nf], email);
      const a = r.achadas[nf];
      if (!a) { setBusca({ nf, estado: "nao" }); return null; }
      setNota((x) => (String(x.numnota).replace(/\D/g, "") !== nf ? x : {
        ...x,
        numped: a.numped || x.numped,
        valor: a.valor != null ? a.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : x.valor,
        peso: a.peso != null ? a.peso.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : x.peso,
        carregamento: a.carregamento || x.carregamento,
        cliente: a.cliente, codcli: a.codcli, destino: a.destino, placa_road: a.placa_road,
      }));
      setBusca({ nf, estado: "achou", nota: a });
      setTimeout(() => document.getElementById("na-bairro")?.focus(), 50);
      return a;
    } catch (e) {
      setBusca({ nf, estado: "erro", erro: e.message });
      return null;
    }
  }
  useEffect(() => {
    if (modo !== "UMA" || nfDigitada.length < 5 || busca.nf === nfDigitada) return;
    const t = setTimeout(() => buscarUma(nfDigitada), 600);
    return () => clearTimeout(t);
  }, [nfDigitada, modo]);

  // ---- colando: busca todas as notas na ROAD de uma vez ----
  useEffect(() => {
    const nfs = (leitura?.notas || []).map((n) => n.numnota);
    const chave = nfs.join(",");
    if (!nfs.length || chave === road.chave) return;
    const t = setTimeout(async () => {
      setRoad({ chave, achadas: {}, faltando: [], estado: "buscando" });
      try {
        const r = await buscarNaRoad(nfs, email);
        setRoad({ chave, achadas: r.achadas, faltando: r.faltando, estado: "ok" });
      } catch (e) {
        setRoad({ chave, achadas: {}, faltando: [], estado: "erro", erro: e.message });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [leitura]);

  async function gravar(lista) {
    setSalvando(true);
    const regs = lista.map((n) => ({ ...n, dt_registro: hoje, registrado_por: email || null, status: "PENDENTE" }));
    const { error } = await sb().from("notas_agendadas").insert(regs);
    setSalvando(false);
    if (error) { aoErro(/duplicate|unique/i.test(error.message) ? "Alguma dessas notas já está cadastrada." : error.message); return false; }
    return true;
  }
  async function adicionarUma(e) {
    e.preventDefault();
    const numnota = nfDigitada;
    if (!numnota) return aoErro("Informe o número da nota fiscal.");
    if (existentes.has(numnota)) return aoErro(`A nota ${numnota} já está cadastrada.`);
    // Enter logo depois de digitar: primeiro busca na ROAD e preenche; o próximo Enter adiciona
    if (busca.nf !== numnota) { await buscarUma(numnota); return; }
    if (busca.estado === "buscando") return;
    if (!BAIRROS_MANAUS.includes(bairro)) { document.getElementById("na-bairro")?.focus(); return aoErro("Selecione um Bairro da lista antes de salvar."); }
    const ok = await gravar([{ bairro,
      numnota, numped: String(nota.numped).replace(/\D/g, ""), codcli: nota.codcli || "",
      cliente: (nota.cliente || padrao.cliente).toUpperCase(),
      valor: lerNumeroBR(nota.valor), peso: lerNumeroBR(nota.peso), carregamento: String(nota.carregamento).replace(/\D/g, ""),
      destino: (nota.destino || padrao.destino).toUpperCase(), placa_ficticia: normPlaca(nota.placa_road) || padrao.placa_ficticia, obs: nota.obs.trim(),
    }]);
    if (ok) {
      aoAdicionar(`Nota ${numnota} adicionada${nota.cliente ? ` · ${nota.cliente}` : ""} · ${bairro} · em ${normPlaca(nota.placa_road) || padrao.placa_ficticia}.`);
      setNota(VAZIA); setBusca({ nf: "", estado: "" }); setBairro("");
      document.getElementById("na-nf")?.focus();
    }
  }
  async function adicionarColadas() {
    if (!novas.length) return;
    if (semBairro) return aoErro(`Falta o bairro de ${semBairro} nota(s): escolha o bairro para todas ou em cada linha.`);
    if (await gravar(novas)) { setTexto(""); setBairros({}); setBairroTodas(""); aoAdicionar(`${novas.length} nota(s) adicionada(s)${repetidas ? ` · ${repetidas} já estavam cadastradas e foram ignoradas` : ""}.`); }
  }

  const achadasColadas = coladas.filter((n) => road.achadas[n.numnota]).length;

  return (
    <section className="cartao na-add">
      <div className="na-add-topo">
        <b>Adicionar notas fiscais</b>
        <div className="linha-acoes">
          <button className={`btn mini ${modo === "UMA" ? "primario" : ""}`} onClick={() => { setModo("UMA"); setAberto(true); }}>Digitar</button>
          <button className={`btn mini ${modo === "COLAR" ? "primario" : ""}`} onClick={() => { setModo("COLAR"); setAberto(true); }}>Colar várias</button>
          <button className="btn link" onClick={() => setAberto(!aberto)}>{aberto ? "▴ recolher" : "▾ abrir"}</button>
        </div>
      </div>
      {aberto && (
        <>
          {modo === "UMA" ? (
            <>
              <form className="na-form" onSubmit={adicionarUma}>
                <label className="campo-data">Nota fiscal *
                  <input id="na-nf" className="campo" inputMode="numeric" value={nota.numnota} autoFocus style={{ width: 130 }}
                    onChange={(e) => setNota({ ...VAZIA, obs: nota.obs, numnota: e.target.value })}
                    onBlur={() => nfDigitada && busca.nf !== nfDigitada && buscarUma(nfDigitada)} />
                </label>
                <label className="campo-data">Pedido<input className="campo" inputMode="numeric" value={nota.numped} onChange={(e) => setNota({ ...nota, numped: e.target.value })} style={{ width: 130 }} /></label>
                <label className="campo-data">Valor (R$)<input className="campo" inputMode="decimal" value={nota.valor} onChange={(e) => setNota({ ...nota, valor: e.target.value })} placeholder="0,00" style={{ width: 110 }} /></label>
                <label className="campo-data">Peso (kg)<input className="campo" inputMode="decimal" value={nota.peso} onChange={(e) => setNota({ ...nota, peso: e.target.value })} placeholder="0,000" style={{ width: 100 }} /></label>
                <label className="campo-data">Carregamento<input className="campo" inputMode="numeric" value={nota.carregamento} onChange={(e) => setNota({ ...nota, carregamento: e.target.value })} style={{ width: 120 }} /></label>
                <label className="campo-data na-bairro">Bairro *
                  <ComboBairro id="na-bairro" valor={bairro} aoMudar={setBairro} aoEscolher={() => setTimeout(() => document.getElementById("na-salvar")?.focus(), 30)} />
                </label>
                <label className="campo-data">Obs<input className="campo" value={nota.obs} onChange={(e) => setNota({ ...nota, obs: e.target.value })} style={{ minWidth: 140 }} /></label>
                <button id="na-salvar" className="btn primario" disabled={salvando || busca.estado === "buscando"}>{salvando ? "Salvando…" : "＋ Adicionar"}</button>
              </form>
              <div className={`na-road na-road-${busca.nf === nfDigitada ? busca.estado : ""}`}>
                {!nfDigitada ? <span className="sub">Digite a nota fiscal: pedido, cliente, valor, peso e carregamento são preenchidos pela ROAD.</span>
                  : existentes.has(nfDigitada) ? <span className="t-laranja">A nota {nfDigitada} já está cadastrada nesta aba.</span>
                  : busca.nf !== nfDigitada ? <span className="sub">aperte Enter ou espere para buscar na ROAD…</span>
                  : busca.estado === "buscando" ? <span className="sub">🔎 buscando a nota {nfDigitada} na ROAD…</span>
                  : busca.estado === "achou" ? <span>✔ Encontrada na ROAD: <b>{busca.nota.cliente || "—"}</b>{busca.nota.placa_road ? <> · placa <b>{busca.nota.placa_road}</b></> : ""}{busca.nota.destino ? ` · ${busca.nota.destino}` : ""}{busca.nota.dt_liberado ? ` · liberado ${dm(busca.nota.dt_liberado)}` : ""} <small className="sub">— escolha o bairro e clique em ＋ Adicionar</small></span>
                  : busca.estado === "nao" ? <span className="t-laranja">Nota {nfDigitada} não encontrada na ROAD — preencha os campos à mão, escolha o bairro e adicione.</span>
                  : <span className="t-vermelho">Não deu para consultar a ROAD: {busca.erro}</span>}
              </div>
            </>
          ) : (
            <>
              <textarea className="colar" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder={"Cole os números das notas fiscais (um por linha) — o resto vem da ROAD.\nTambém aceita colar do Excel/Winthor com cabeçalho (NUMNOTA, NUMPED, CLIENTE, VLTOTAL, PESOBRUTOTOT, NUMCARREGAMENTO, BAIRRO…)."} />
              <div className="linha-acoes">
                {leitura && (leitura.erro ? <span className="t-vermelho">{leitura.erro}</span> : (
                  <span>
                    <b>{coladas.length}</b> nota(s) · {moeda(somar(coladas).valor)} · {num(somar(coladas).peso)} kg
                    {road.estado === "buscando" && <span className="sub"> · 🔎 buscando na ROAD…</span>}
                    {road.estado === "ok" && <> · <b className="t-verde">{achadasColadas} achada(s) na ROAD</b>{road.faltando.length ? <b className="t-laranja"> · {road.faltando.length} não achada(s): {road.faltando.slice(0, 8).join(", ")}{road.faltando.length > 8 ? "…" : ""}</b> : ""}</>}
                    {road.estado === "erro" && <span className="t-vermelho"> · ROAD: {road.erro}</span>}
                    {repetidas > 0 && <b className="t-laranja"> · {repetidas} já cadastrada(s)</b>}
                  </span>
                ))}
                <label className="campo-data na-bairro">Bairro (para todas)
                  <ComboBairro valor={bairroTodas} aoMudar={setBairroTodas} />
                </label>
                {semBairro > 0 && novas.length > 0 && <span className="t-laranja">{semBairro} sem bairro</span>}
                <button className="btn primario" disabled={!novas.length || salvando || road.estado === "buscando"} onClick={adicionarColadas}>{salvando ? "Salvando…" : `＋ Adicionar ${novas.length || ""} nota(s)`}</button>
              </div>
              {coladas.length > 0 && road.estado === "ok" && (
                <div className="tabela-rolagem na-previa">
                  <table className="na">
                    <thead><tr><th>Nota fiscal</th><th>Pedido</th><th>Cliente</th><th>Bairro</th><th>Placa</th><th>Carreg.</th><th className="n">Peso (kg)</th><th className="n">Valor</th><th></th></tr></thead>
                    <tbody>
                      {coladas.slice(0, 200).map((n) => (
                        <tr key={n.numnota} className={existentes.has(n.numnota) ? "na-repetida" : ""}>
                          <td className="ag-ped"><b>{n.numnota}</b></td><td className="ag-ped">{n.numped || "—"}</td><td className="ag-cli">{n.cliente}</td>
                          <td>
                            <select className={`campo mini ${n.bairro ? "" : "na-falta"}`} value={n.bairro} onChange={(e) => setBairros({ ...bairros, [n.numnota]: e.target.value })} disabled={existentes.has(n.numnota)}>
                              <option value="">— bairro —</option>
                              {BAIRROS_MANAUS.map((b) => <option key={b}>{b}</option>)}
                            </select>
                          </td>
                          <td>{n.placa_ficticia}</td><td>{n.carregamento || "—"}</td>
                          <td className="n">{n.peso != null ? num(n.peso) : "—"}</td><td className="n">{n.valor != null ? moeda(n.valor) : "—"}</td>
                          <td className="sub">{existentes.has(n.numnota) ? "já cadastrada" : road.achadas[n.numnota] ? "ROAD" : "não achada"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------- pendentes + roteirizar ----------------
function Pendentes({ pend, hoje, email, placasCad, carregando, aviso, recarregar }) {
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [placa, setPlaca] = useState("");
  const [dtSaida, setDtSaida] = useState("");
  const [freteDia, setFreteDia] = useState([]);
  const [enviando, setEnviando] = useState(false);

  // frete do dia da saída: placas sugeridas e motorista / entregador
  useEffect(() => {
    if (!dtSaida) { setFreteDia([]); return; }
    let vivo = true;
    sb().from("saidas").select("*").eq("data", dtSaida).then(({ data }) => { if (vivo) setFreteDia(data || []); });
    return () => { vivo = false; };
  }, [dtSaida]);

  const b = busca.trim().toUpperCase();
  const lista = pend.filter((n) => !b || [n.numnota, n.numped, n.cliente, n.bairro, n.placa_ficticia, n.destino, n.carregamento, n.obs].some((x) => String(x || "").toUpperCase().includes(b)));
  const sel = lista.filter((n) => marcadas.has(n.id));
  const tS = somar(sel);
  const todas = lista.length > 0 && lista.every((n) => marcadas.has(n.id));
  const nomes = nomesDoFrete(freteDia, placa);
  const placaN = normPlaca(placa);

  function alternar(id) { const n = new Set(marcadas); n.has(id) ? n.delete(id) : n.add(id); setMarcadas(n); }

  async function roteirizar() {
    if (!sel.length) return aviso("erro", "Marque ao menos uma nota na tabela.");
    if (!placaN) return aviso("erro", "Informe a nova placa.");
    if (!dtSaida) return aviso("erro", "Informe a data de saída.");
    setEnviando(true);
    const placaFinal = nomes?.placaAtual || placaN; // placa trocada no frete: grava a atual
    const { error } = await sb().from("notas_agendadas").update({
      status: "ROTEIRIZADO", placa: placaFinal, dt_saida: dtSaida,
      motorista: nomes?.motorista || "", entregador: nomes?.entregador || "",
      roteirizado_em: new Date().toISOString(), roteirizado_por: email || null, updated_at: new Date().toISOString(),
    }).in("id", sel.map((n) => n.id));
    setEnviando(false);
    if (error) return aviso("erro", error.message);
    aviso("ok", `${sel.length} nota(s) roteirizada(s) na placa ${placaFinal}${nomes?.trocada ? ` (${placaN} foi trocada no frete por ${placaFinal})` : ""} · saída ${fmtData(dtSaida)}${nomes ? "" : " · a placa ainda não está no frete desse dia (motorista/entregador em branco)"}.`);
    setMarcadas(new Set()); setPlaca("");
    recarregar();
  }
  async function excluir(n) {
    if (!confirm(`Excluir a nota ${n.numnota} (${n.cliente})?`)) return;
    const { error } = await sb().from("notas_agendadas").delete().eq("id", n.id);
    if (error) return aviso("erro", error.message);
    recarregar();
  }
  async function excluirMarcadas() {
    if (!confirm(`Excluir ${sel.length} nota(s) marcada(s)?`)) return;
    const { error } = await sb().from("notas_agendadas").delete().in("id", sel.map((n) => n.id));
    if (error) return aviso("erro", error.message);
    setMarcadas(new Set()); recarregar();
  }

  // placas sugeridas: as do frete do dia primeiro, depois as cadastradas
  const sugestoes = [...new Set([...freteDia.map((s) => s.placa), ...placasCad.map((v) => v.placa)])];

  return (
    <section className="cartao sem-pad na-pend">
      <div className="barra-tabela">
        <div><b className="t-vermelho">Notas pendentes</b> <span className="sub">· {pend.length} nota(s) em placa fictícia</span></div>
        <input className="campo" placeholder="Buscar nota, pedido, cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
      </div>
      <div className="tabela-rolagem">
        <table className="na">
          <thead><tr>
            <th className="na-ck"><input type="checkbox" checked={todas} onChange={() => setMarcadas(todas ? new Set() : new Set(lista.map((n) => n.id)))} title="Marcar todas" /></th>
            <th>Nota fiscal</th><th>Pedido</th><th>Cliente</th><th>Bairro</th><th>Placa fictícia</th><th>Destino</th><th>Carreg.</th><th>Registro</th><th className="n">Dias</th><th className="n">Peso (kg)</th><th className="n">Valor</th><th>Obs</th><th></th>
          </tr></thead>
          <tbody>
            {lista.map((n) => (
              <tr key={n.id} className={marcadas.has(n.id) ? "marcado" : ""} onClick={() => alternar(n.id)} style={{ cursor: "pointer" }}>
                <td className="na-ck" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={marcadas.has(n.id)} onChange={() => alternar(n.id)} /></td>
                <td className="ag-ped"><b>{n.numnota}</b></td>
                <td className="ag-ped">{n.numped || "—"}</td>
                <td className="ag-cli" title={n.cliente}>{n.cliente}</td>
                <td>{n.bairro || <span className="sub">—</span>}</td>
                <td><span className="na-fict">{n.placa_ficticia}</span></td>
                <td>{n.destino}</td>
                <td>{n.carregamento || "—"}</td>
                <td title={n.registrado_por ? `por ${n.registrado_por}` : ""}>{dm(n.dt_registro)}</td>
                <td className="n">{diasDesde(n.dt_registro, hoje)}</td>
                <td className="n">{n.peso != null ? num(n.peso) : "—"}</td>
                <td className="n">{n.valor != null ? moeda(n.valor) : "—"}</td>
                <td className="sub">{n.obs}</td>
                <td className="na-x" onClick={(e) => e.stopPropagation()}><button className="btn-x" onClick={() => excluir(n)} title="Excluir nota">✕</button></td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={14} className="vazio">{carregando ? "Carregando…" : b ? "Nenhuma nota com essa busca." : "Nenhuma nota pendente. 👍"}</td></tr>}
          </tbody>
          {lista.length > 0 && <tfoot><tr><td colSpan={10}>TOTAL · {lista.length} nota(s)</td><td className="n">{num(somar(lista).peso)}</td><td className="n">{moeda(somar(lista).valor)}</td><td colSpan={2}></td></tr></tfoot>}
        </table>
      </div>

      <div className="na-rot">
        <div className="na-rot-tit">
          <b>Roteirizar</b>
          {sel.length
            ? <span><b>{sel.length}</b> nota(s) · {new Set(sel.map((n) => n.cliente)).size} cliente(s) · {num(tS.peso)} kg · {moeda(tS.valor)}
                <button className="btn link perigo" onClick={excluirMarcadas}>excluir marcadas</button></span>
            : <span className="sub">marque as notas na tabela acima</span>}
        </div>
        <div className="na-form">
          <label className="campo-data">Data de saída *
            <input className="campo" type="date" value={dtSaida} onChange={(e) => setDtSaida(e.target.value)} />
          </label>
          <div className="linha-acoes na-dias">
            {[["Hoje", 0], ["Amanhã", 1], ["D+2", 2]].map(([t, d]) => (
              <button key={t} type="button" className={`btn mini ${dtSaida === somarDias(hoje, d) ? "primario" : ""}`} onClick={() => setDtSaida(somarDias(hoje, d))}>{t}</button>
            ))}
          </div>
          <label className="campo-data">Nova placa *
            <input className="campo" list="na-placas" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" style={{ width: 130 }} />
            <datalist id="na-placas">{sugestoes.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <div className="na-nomes">
            {!placaN || !dtSaida ? <span className="sub">motorista e entregador vêm do frete da placa nesse dia</span>
              : nomes ? <span>{nomes.trocada && <span className="marca-troca">⇄ {placaN} » {nomes.placaAtual}</span>} 🚚 No frete de {dm(dtSaida)}: <b>{nomes.motorista || "sem motorista"}</b> · <b>{nomes.entregador || "sem entregador"}</b>{nomes.destino ? <small className="sub"> · {nomes.destino}</small> : ""}</span>
              : <span className="t-laranja">{placaN} não está no frete de {dm(dtSaida)} — dá para roteirizar; os nomes ficam em branco e você atualiza depois.</span>}
          </div>
          <button className="btn primario" disabled={enviando || !sel.length} onClick={roteirizar}>{enviando ? "Roteirizando…" : `✅ Roteirizar ${sel.length || ""} nota(s)`}</button>
        </div>
        {dtSaida && freteDia.length > 0 && (
          <div className="na-frete-dia">
            <span className="sub">Placas no frete de {dm(dtSaida)}:</span>
            {freteDia.slice().sort((a, b) => String(a.placa).localeCompare(String(b.placa))).map((s) => (
              <button key={s.id} type="button" className={`na-chip-placa ${normPlaca(s.placa) === placaN ? "sel" : ""}`} onClick={() => setPlaca(s.placa)} title={`${s.motorista || "—"} · ${s.entregador || "—"} · ${s.destino || s.zona || ""}`}>
                {s.placa}<small>{s.zona || s.destino}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------- roteirizadas + relatório por placa ----------------
function Roteirizadas({ rote, de, ate, setDe, setAte, hoje, aviso, recarregar }) {
  const [busca, setBusca] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const b = busca.trim().toUpperCase();
  const lista = rote.filter((n) => !b || [n.numnota, n.numped, n.cliente, n.placa, n.placa_ficticia, n.motorista, n.entregador].some((x) => String(x || "").toUpperCase().includes(b)));
  const t = somar(lista);

  const grupos = useMemo(() => {
    const m = new Map();
    for (const n of lista) {
      const k = `${n.dt_saida}|${n.placa}`;
      const g = m.get(k) || { k, dt_saida: n.dt_saida, placa: n.placa, motorista: n.motorista, entregador: n.entregador, notas: [], clientes: new Set() };
      g.notas.push(n); g.clientes.add(n.cliente); g.motorista ||= n.motorista; g.entregador ||= n.entregador;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => String(b.dt_saida).localeCompare(String(a.dt_saida)) || a.placa.localeCompare(b.placa));
  }, [lista]);

  async function devolver(n) {
    if (!confirm(`Devolver a nota ${n.numnota} (${n.cliente}) para PENDENTE?`)) return;
    const { error } = await sb().from("notas_agendadas").update({ status: "PENDENTE", placa: "", dt_saida: null, motorista: "", entregador: "", roteirizado_em: null, roteirizado_por: null, updated_at: new Date().toISOString() }).eq("id", n.id);
    if (error) return aviso("erro", error.message);
    recarregar();
  }
  // busca de novo motorista / entregador no frete (para as notas roteirizadas antes de a placa entrar no frete, ou com troca de nomes)
  async function atualizarNomes() {
    setAtualizando(true);
    const datas = [...new Set(lista.map((n) => n.dt_saida))];
    const { data, error } = await sb().from("saidas").select("*").in("data", datas);
    if (error) { setAtualizando(false); return aviso("erro", error.message); }
    let mudou = 0;
    for (const n of lista) {
      const f = nomesDoFrete((data || []).filter((s) => s.data === n.dt_saida), n.placa);
      if (f && (f.motorista !== n.motorista || f.entregador !== n.entregador)) {
        const r = await sb().from("notas_agendadas").update({ motorista: f.motorista, entregador: f.entregador, updated_at: new Date().toISOString() }).eq("id", n.id);
        if (!r.error) mudou++;
      }
    }
    setAtualizando(false);
    aviso("ok", mudou ? `Motorista/entregador atualizados em ${mudou} nota(s).` : "Nada para atualizar: os nomes já estão iguais aos do frete (ou as placas ainda não estão no frete).");
    recarregar();
  }
  function exportar() {
    baixarCSV(`notas_agendadas_${de}_a_${ate}.csv`, ["NOTA FISCAL", "PEDIDO", "CLIENTE", "BAIRRO", "PLACA FICTICIA", "NOVA PLACA", "DATA SAIDA", "MOTORISTA", "ENTREGADOR", "DESTINO", "CARREGAMENTO", "PESO", "VALOR", "ROTEIRIZADO POR"],
      lista.map((n) => [n.numnota, n.numped, n.cliente, n.bairro || "", n.placa_ficticia, n.placa, fmtData(n.dt_saida), n.motorista, n.entregador, n.destino, n.carregamento, br(n.peso), br(n.valor), n.roteirizado_por || ""]));
  }

  return (
    <>
      <section className="cartao sem-pad na-rote">
        <div className="barra-tabela">
          <div><b className="t-verde">Notas roteirizadas</b> <span className="sub">· pela data de saída</span></div>
          <div className="linha-acoes">
            <label className="campo-data">Saída de<input type="date" value={de} onChange={(e) => setDe(e.target.value || hoje)} /></label>
            <label className="campo-data">até<input type="date" value={ate} onChange={(e) => setAte(e.target.value || hoje)} /></label>
            <input className="campo" placeholder="Buscar nota, cliente, placa, motorista…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
            <button className="btn link" onClick={atualizarNomes} disabled={atualizando || !lista.length}>{atualizando ? "Atualizando…" : "↻ nomes do frete"}</button>
            <button className="btn link" onClick={exportar} disabled={!lista.length}>⭳ Excel (CSV)</button>
          </div>
        </div>
        <div className="tabela-rolagem">
          <table className="na">
            <thead><tr><th>Nota fiscal</th><th>Pedido</th><th>Cliente</th><th>Bairro</th><th>Placa</th><th>Saída</th><th>Motorista</th><th>Entregador</th><th className="n">Peso (kg)</th><th className="n">Valor</th><th>Roteirizado</th><th></th></tr></thead>
            <tbody>
              {lista.map((n) => (
                <tr key={n.id}>
                  <td className="ag-ped"><b>{n.numnota}</b></td>
                  <td className="ag-ped">{n.numped || "—"}</td>
                  <td className="ag-cli" title={n.cliente}>{n.cliente}</td>
                  <td>{n.bairro || <span className="sub">—</span>}</td>
                  <td><span className="na-troca"><s>{n.placa_ficticia}</s> » <b>{n.placa}</b></span></td>
                  <td>{dm(n.dt_saida)}</td>
                  <td>{n.motorista || <span className="sub">—</span>}</td>
                  <td>{n.entregador || <span className="sub">—</span>}</td>
                  <td className="n">{n.peso != null ? num(n.peso) : "—"}</td>
                  <td className="n">{n.valor != null ? moeda(n.valor) : "—"}</td>
                  <td className="sub">{fmtDataHora(n.roteirizado_em)}{n.roteirizado_por ? ` · ${n.roteirizado_por}` : ""}</td>
                  <td><button className="btn mini" onClick={() => devolver(n)} title="Voltar para pendente">↩ Devolver</button></td>
                </tr>
              ))}
              {!lista.length && <tr><td colSpan={12} className="vazio">Nenhuma nota roteirizada com saída entre {dm(de)} e {dm(ate)}.</td></tr>}
            </tbody>
            {lista.length > 0 && <tfoot><tr><td colSpan={8}>TOTAL · {lista.length} nota(s)</td><td className="n">{num(t.peso)}</td><td className="n">{moeda(t.valor)}</td><td colSpan={2}></td></tr></tfoot>}
          </table>
        </div>
      </section>

      {grupos.length > 0 && (
        <section className="cartao sem-pad">
          <div className="barra-tabela"><b>Relatório por placa</b><span className="sub">{new Set(grupos.map((g) => g.placa)).size} placa(s)</span></div>
          <div className="tabela-rolagem">
            <table className="na">
              <thead><tr><th>Saída</th><th>Placa</th><th>Motorista</th><th>Entregador</th><th className="n">Notas</th><th className="n">Clientes</th><th className="n">Peso (kg)</th><th className="n">Valor</th></tr></thead>
              <tbody>
                {grupos.map((g) => {
                  const s = somar(g.notas);
                  return (
                    <tr key={g.k}>
                      <td>{dm(g.dt_saida)}</td><td><b>{g.placa}</b></td><td>{g.motorista || "—"}</td><td>{g.entregador || "—"}</td>
                      <td className="n">{g.notas.length}</td><td className="n">{g.clientes.size}</td><td className="n">{num(s.peso)}</td><td className="n">{moeda(s.valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
