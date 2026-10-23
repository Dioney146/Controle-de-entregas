"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import { useTempoReal } from "../../lib/hooks";
import { useColunas } from "../../lib/colunas";
import { useUsuario } from "../../components/Casca";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { lerLiberados, textoParaMatriz, diasNaCarteira, FAIXAS, faixaDe } from "../../lib/backlog";
import { hojeISO, somarDias, fmtData, fmtDataHora, num, moeda } from "../../lib/util";

// Backlog: pedidos na carteira (relatório de LIBERADOS do Winthor).
// L = liberado (ainda não montado) · M = montado (ainda não separado).
// Sai da carteira quando some do relatório colado. Dias contados desde a DATA de liberação.

const ABAS = [{ k: "CARTEIRA", t: "Na carteira" }, { k: "SAIRAM", t: "Saíram da carteira" }, { k: "HIST", t: "Colagens" }];
const POS = { L: { rot: "Liberado", classe: "bk-l", dica: "Liberado, ainda não montado" }, M: { rot: "Montado", classe: "bk-m", dica: "Montado, ainda não separado" } };
const AGRUPAR = [
  { k: "praca", t: "Praça" }, { k: "cidade", t: "Cidade" }, { k: "supervisor", t: "Supervisor" }, { k: "rca", t: "RCA" }, { k: "cliente", t: "Cliente" },
];
const somar = (l) => ({ qtd: l.length, peso: l.reduce((s, p) => s + (Number(p.peso) || 0), 0), valor: l.reduce((s, p) => s + (Number(p.valor) || 0), 0) });
const media = (l, f) => (l.length ? l.reduce((s, x) => s + (f(x) || 0), 0) / l.length : 0);
const dec1 = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const lotes = (arr, n = 200) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const COLUNAS = {
  pos: { valor: (p) => POS[p.posicao]?.rot || p.posicao },
  dias: { valor: (p) => p.dias, numero: true },
  lib: { valor: (p) => p.data_liberacao || "" },
  numped: { valor: (p) => p.numped },
  cliente: { valor: (p) => p.cliente },
  cidade: { valor: (p) => p.cidade },
  praca: { valor: (p) => p.praca },
  supervisor: { valor: (p) => p.supervisor },
  rca: { valor: (p) => p.rca },
  peso: { valor: (p) => p.peso, numero: true },
  valor: { valor: (p) => p.valor, numero: true },
  carreg: { valor: (p) => p.carregamento },
  saiu: { valor: (p) => (p.saiu_em ? p.saiu_em.slice(0, 10) : "") },
};

export default function Backlog() {
  const { email } = useUsuario();
  const hoje = hojeISO();
  const [aba, setAba] = useState("CARTEIRA");
  const [carteira, setCarteira] = useState([]);
  const [sairam, setSairam] = useState([]);
  const [colagens, setColagens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [semTabela, setSemTabela] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtroPos, setFiltroPos] = useState("");
  const [filtroFaixa, setFiltroFaixa] = useState("");
  const [agrupar, setAgrupar] = useState("praca");
  const [saiuDe, setSaiuDe] = useState(hoje);
  const [saiuAte, setSaiuAte] = useState(hoje);
  // importação
  const [abrirColar, setAbrirColar] = useState(false);
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState(null); // { nome, leitura }
  const [salvando, setSalvando] = useState(false);
  const f = useFiltros(COLUNAS);

  async function carregar() {
    try {
      const [c, s, h] = await Promise.all([
        buscarTudo(() => sb().from("backlog_pedidos").select("*").is("saiu_em", null).order("data_liberacao").order("numped")),
        buscarTudo(() => sb().from("backlog_pedidos").select("*").gte("saiu_em", `${saiuDe}T00:00:00-04:00`).lte("saiu_em", `${saiuAte}T23:59:59-04:00`).order("saiu_em", { ascending: false })),
        sb().from("backlog_importacoes").select("*").order("quando", { ascending: false }).limit(60),
      ]);
      setCarteira(c || []); setSairam(s || []); setColagens(h.data || []);
      setSemTabela(false);
    } catch (e) {
      setSemTabela(/backlog|relation|schema cache/i.test(e?.message || ""));
    }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, [saiuDe, saiuAte]);
  useTempoReal(carregar, [saiuDe, saiuAte]);

  // ---------- leitura do que foi colado / enviado ----------
  const leitura = useMemo(() => (arquivo ? arquivo.leitura : texto.trim() ? lerLiberados(textoParaMatriz(texto)) : null), [texto, arquivo]);
  const diff = useMemo(() => {
    if (!leitura?.pedidos.length) return null;
    const naCarteira = new Set(carteira.map((p) => p.numped));
    const noRel = new Set(leitura.pedidos.map((p) => p.numped));
    return {
      entram: leitura.pedidos.filter((p) => !naCarteira.has(p.numped)).length,
      continuam: leitura.pedidos.filter((p) => naCarteira.has(p.numped)).length,
      saem: carteira.filter((p) => !noRel.has(p.numped)).length,
      viraramM: leitura.pedidos.filter((p) => p.posicao === "M" && carteira.some((c) => c.numped === p.numped && c.posicao === "L")).length,
    };
  }, [leitura, carteira]);

  async function lerArquivo(e) {
    const arq = e.target.files?.[0];
    if (!arq) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    setArquivo({ nome: arq.name, leitura: lerLiberados(matriz) });
    setTexto("");
    e.target.value = "";
  }

  async function importar() {
    if (!leitura?.pedidos.length || !diff) return;
    const total = carteira.length;
    if (diff.saem > 0 && total > 20 && diff.saem / total > 0.5
      && !confirm(`Atenção: ${diff.saem} de ${total} pedidos (${Math.round((diff.saem / total) * 100)}%) vão SAIR da carteira, porque não estão neste relatório.\n\nIsso está certo? Se o relatório estiver incompleto (filtro, outra filial, parte das linhas), cancele e cole o relatório inteiro.`)) return;
    setSalvando(true);
    try {
      const agora = new Date().toISOString();
      const rel = leitura.pedidos;
      // pedidos do relatório que já existem no banco (na carteira ou que tinham saído e voltaram)
      const existentes = new Map();
      for (const lote of lotes(rel.map((p) => p.numped))) {
        const { data, error } = await sb().from("backlog_pedidos").select("*").in("numped", lote);
        if (error) throw error;
        (data || []).forEach((x) => existentes.set(x.numped, x));
      }
      const novos = rel.filter((p) => !existentes.has(p.numped)).map((p) => ({
        ...p, visto_primeiro: agora, visto_ultimo: agora, montado_em: p.posicao === "M" ? agora : null,
      }));
      for (const lote of lotes(novos)) {
        const { error } = await sb().from("backlog_pedidos").insert(lote);
        if (error) throw error;
      }
      // já existiam: marca que apareceu de novo (em lote) e atualiza só o que mudou
      const velhos = rel.filter((p) => existentes.has(p.numped));
      for (const lote of lotes(velhos.map((p) => p.numped))) {
        const { error } = await sb().from("backlog_pedidos").update({ visto_ultimo: agora }).in("numped", lote);
        if (error) throw error;
      }
      const CAMPOS = ["posicao", "cliente", "peso", "valor", "carregamento", "placa", "destino", "praca", "cidade", "numnota", "rca", "supervisor", "dt_entrega", "data_liberacao", "hora_liberacao"];
      for (const p of velhos) {
        const x = existentes.get(p.numped);
        const mud = {};
        for (const c of CAMPOS) if (p[c] != null && p[c] !== "" && String(p[c]) !== String(x[c] ?? "")) mud[c] = p[c];
        if (p.posicao === "M" && !x.montado_em) mud.montado_em = agora;
        if (x.saiu_em) { mud.saiu_em = null; mud.posicao_saida = ""; } // tinha saído e voltou para a carteira
        if (Object.keys(mud).length) {
          const { error } = await sb().from("backlog_pedidos").update(mud).eq("id", x.id);
          if (error) throw error;
        }
      }
      // estavam na carteira e não vieram no relatório: saíram (separados / faturados / cancelados)
      const noRel = new Set(rel.map((p) => p.numped));
      const saem = carteira.filter((p) => !noRel.has(p.numped));
      for (const pos of ["L", "M"]) {
        for (const lote of lotes(saem.filter((p) => p.posicao === pos).map((p) => p.id))) {
          const { error } = await sb().from("backlog_pedidos").update({ saiu_em: agora, posicao_saida: pos }).in("id", lote);
          if (error) throw error;
        }
      }
      const L = rel.filter((p) => p.posicao === "L"), M = rel.filter((p) => p.posicao === "M");
      await sb().from("backlog_importacoes").insert({
        usuario: email || null, qtd_l: L.length, qtd_m: M.length,
        peso_l: somar(L).peso, peso_m: somar(M).peso, valor_l: somar(L).valor, valor_m: somar(M).valor,
        entraram: novos.length, sairam: saem.length,
      });
      setMsg({ tipo: "ok", txt: `Carteira atualizada: ${rel.length} pedidos no relatório (${L.length} liberados · ${M.length} montados) · ${novos.length} entraram · ${saem.length} saíram.` });
      setTexto(""); setArquivo(null); setAbrirColar(false);
      carregar();
    } catch (e) {
      setMsg({ tipo: "erro", txt: e.message || String(e) });
    }
    setSalvando(false);
  }

  // ---------- números ----------
  const comDias = useMemo(() => carteira.map((p) => ({ ...p, dias: diasNaCarteira(p, hoje) })), [carteira, hoje]);
  const saidasDias = useMemo(() => sairam.map((p) => ({ ...p, dias: diasNaCarteira(p, hoje) })), [sairam, hoje]);
  const b = busca.trim().toUpperCase();
  const casa = (p) => !b || [p.numped, p.cliente, p.cidade, p.praca, p.rca, p.supervisor, p.carregamento, p.placa].some((x) => String(x || "").toUpperCase().includes(b));
  const baseCarteira = comDias.filter(casa);
  const filtrada = baseCarteira.filter((p) => (!filtroPos || p.posicao === filtroPos) && (!filtroFaixa || faixaDe(p.dias)?.k === filtroFaixa));
  const baseSairam = saidasDias.filter(casa);
  const lista = [...(aba === "SAIRAM" ? baseSairam : filtrada)].sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1) || String(a.numped).localeCompare(String(b.numped)));
  const visiveis = f.aplicar(lista);
  const [refTabela, ajustarColunas] = useColunas(`backlog-${aba}`, `${carregando}-${visiveis.length}`);

  const tot = somar(baseCarteira), totL = somar(baseCarteira.filter((p) => p.posicao === "L")), totM = somar(baseCarteira.filter((p) => p.posicao === "M"));
  const idadeMedia = media(baseCarteira, (p) => p.dias);
  const idadeMediaM = media(baseCarteira.filter((p) => p.posicao === "M"), (p) => p.dias);
  const maisVelho = baseCarteira.reduce((m, p) => Math.max(m, p.dias || 0), 0);
  const atrasados = baseCarteira.filter((p) => (p.dias || 0) >= 2);
  const porFaixa = FAIXAS.map((fx) => {
    const l = baseCarteira.filter((p) => faixaDe(p.dias)?.k === fx.k);
    return { ...fx, ...somar(l), l: l.filter((p) => p.posicao === "L").length, m: l.filter((p) => p.posicao === "M").length };
  });
  const maxFaixa = Math.max(1, ...porFaixa.map((x) => x.qtd));

  // agrupado (praça, cidade, supervisor...)
  const grupos = useMemo(() => {
    const m = new Map();
    for (const p of filtrada) {
      const k = p[agrupar] || "—";
      const g = m.get(k) || { k, lista: [] };
      g.lista.push(p); m.set(k, g);
    }
    return [...m.values()].map((g) => ({
      k: g.k, ...somar(g.lista),
      l: g.lista.filter((p) => p.posicao === "L").length, m: g.lista.filter((p) => p.posicao === "M").length,
      media: media(g.lista, (p) => p.dias), max: g.lista.reduce((mx, p) => Math.max(mx, p.dias || 0), 0),
      atraso: g.lista.filter((p) => (p.dias || 0) >= 2).length,
    })).sort((a, b) => b.media - a.media || b.qtd - a.qtd);
  }, [filtrada, agrupar]);

  // saíram: tempo que ficaram
  const sTot = somar(baseSairam);
  const sMedia = media(baseSairam, (p) => p.dias);
  const sAte1 = baseSairam.filter((p) => (p.dias || 0) <= 1).length;
  const ultima = colagens[0];

  const todasDatas = (d) => { setSaiuAte(hoje); setSaiuDe(somarDias(hoje, -(d - 1))); };

  return (
    <>
      <div className="cabecalho-pagina">
        <div className="abas-pessoas" style={{ marginBottom: 0, borderBottom: 0 }}>
          {ABAS.map((a) => (
            <button key={a.k} className={`aba-p ${aba === a.k ? "ativa" : ""}`} onClick={() => { setAba(a.k); f.limparTudo(); }}>
              {a.t} <small>{a.k === "CARTEIRA" ? carteira.length : a.k === "SAIRAM" ? sairam.length : colagens.length}</small>
            </button>
          ))}
        </div>
        <div className="acoes">
          {ultima && <span className="sub">última colagem: {fmtDataHora(ultima.quando)}{ultima.usuario ? ` por ${ultima.usuario}` : ""}</span>}
          <button className="btn primario" onClick={() => setAbrirColar(!abrirColar)}>{abrirColar ? "Fechar" : "Colar liberados do Winthor"}</button>
        </div>
      </div>

      {semTabela && <div className="alerta aviso">Rode o arquivo <b>17_backlog.sql</b> no Supabase (SQL Editor › Run) para ativar o Backlog.</div>}
      {msg && <div className={`alerta ${msg.tipo}`} onClick={() => setMsg(null)}>{msg.txt}</div>}

      {abrirColar && (
        <section className="cartao ag-colar">
          <p className="sub">
            Cole o relatório de <b>LIBERADOS</b> do Winthor <b>inteiro</b> (com o cabeçalho: NUMPED, POSICAO, DATA…) ou envie o arquivo .xls/.xlsx.
            Quem não estiver no relatório <b>sai da carteira</b> — por isso sempre o relatório completo.
          </p>
          <textarea className="colar" rows={6} value={texto} onChange={(e) => { setTexto(e.target.value); setArquivo(null); }} placeholder="NUMPED	CODCLI	NUMNOTA	CODFILIAL	NOMECLIENTE	POSICAO	DATA	…" />
          <div className="linha-acoes">
            <label className="btn">📄 Enviar arquivo<input type="file" accept=".xls,.xlsx,.csv" onChange={lerArquivo} hidden /></label>
            {arquivo && <span className="sub">{arquivo.nome}</span>}
            {leitura && (leitura.erro
              ? <span className="t-vermelho">{leitura.erro}</span>
              : <span>
                  <b>{leitura.pedidos.length}</b> pedido(s) · <b>{leitura.pedidos.filter((p) => p.posicao === "L").length}</b> liberados · <b>{leitura.pedidos.filter((p) => p.posicao === "M").length}</b> montados · {moeda(somar(leitura.pedidos).valor)} · {num(somar(leitura.pedidos).peso)} kg
                  {leitura.ignoradas > 0 && <small className="sub"> ({leitura.ignoradas} linha(s) de total/rodapé ignorada(s))</small>}
                  {diff && <> — <b className="t-verde">{diff.entram} entram</b> · {diff.continuam} continuam{diff.viraramM ? ` (${diff.viraramM} viraram montados)` : ""} · <b className="t-laranja">{diff.saem} saem</b></>}
                </span>)}
            <button className="btn primario" disabled={!leitura?.pedidos.length || salvando} onClick={importar}>{salvando ? "Atualizando…" : "Atualizar carteira"}</button>
          </div>
        </section>
      )}

      {aba === "CARTEIRA" && (
        <>
          <section className="ag-funil bk-kpis">
            <button className={`ag-etapa et-montado ${!filtroPos ? "sel" : ""}`} onClick={() => setFiltroPos("")}>
              <span>Na carteira</span><b>{tot.qtd} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(tot.valor)}</em><em>{num(tot.peso)} kg</em>
            </button>
            <button className={`ag-etapa bk-kpi-m ${filtroPos === "M" ? "sel" : ""}`} onClick={() => setFiltroPos(filtroPos === "M" ? "" : "M")} title={POS.M.dica}>
              <span>Montados, não separados</span><b>{totM.qtd} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(totM.valor)}</em><em>{num(totM.peso)} kg · {dec1(idadeMediaM)} dia(s) em média</em>
            </button>
            <button className={`ag-etapa bk-kpi-l ${filtroPos === "L" ? "sel" : ""}`} onClick={() => setFiltroPos(filtroPos === "L" ? "" : "L")} title={POS.L.dica}>
              <span>Liberados, não montados</span><b>{totL.qtd} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(totL.valor)}</em><em>{num(totL.peso)} kg</em>
            </button>
            <div className="ag-etapa bk-kpi-idade">
              <span>Dias na carteira</span><b>{dec1(idadeMedia)} <small>em média</small></b>
              <em className="ag-valor">mais antigo: {maisVelho} dia(s)</em><em>desde a data de liberação</em>
            </div>
            <div className="ag-etapa ag-falta" title="Pedidos com 2 dias ou mais na carteira">
              <span>2 dias ou mais</span><b>{atrasados.length} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(somar(atrasados).valor)}</em><em>{num(somar(atrasados).peso)} kg</em>
            </div>
          </section>

          <section className="cartao bk-faixas">
            <div className="bk-faixas-tit"><b>Tempo na carteira</b><span className="sub">clique numa faixa para filtrar · barra escura = montados (M), clara = liberados (L)</span></div>
            {porFaixa.map((x) => (
              <button key={x.k} className={`bk-faixa ${filtroFaixa === x.k ? "sel" : ""}`} onClick={() => setFiltroFaixa(filtroFaixa === x.k ? "" : x.k)}>
                <span className="bk-faixa-rot">{x.rot}</span>
                <span className="bk-barra">
                  <i className="m" style={{ width: `${(x.m / maxFaixa) * 100}%`, background: x.cor }} />
                  <i className="l" style={{ width: `${(x.l / maxFaixa) * 100}%`, background: x.cor }} />
                </span>
                <span className="bk-faixa-num"><b>{x.qtd}</b> <small>({x.m} M · {x.l} L)</small></span>
                <span className="bk-faixa-val">{moeda(x.valor)} · {num(x.peso)} kg</span>
              </button>
            ))}
          </section>

          <section className="cartao sem-pad bk-grupos">
            <div className="barra-tabela">
              <div className="linha-acoes">
                <b>Por</b>
                {AGRUPAR.map((g) => <button key={g.k} className={`btn mini ${agrupar === g.k ? "primario" : ""}`} onClick={() => setAgrupar(g.k)}>{g.t}</button>)}
              </div>
              <span className="sub">ordenado pela média de dias (mais parados primeiro)</span>
            </div>
            <div className="tabela-rolagem bk-grupos-rol">
              <table className="bk-agr">
                <thead><tr><th>{AGRUPAR.find((g) => g.k === agrupar).t}</th><th className="n">Pedidos</th><th className="n">Montados</th><th className="n">Liberados</th><th className="n">Média de dias</th><th className="n">Mais antigo</th><th className="n">2+ dias</th><th className="n">Peso</th><th className="n">Valor</th></tr></thead>
                <tbody>
                  {grupos.map((g) => (
                    <tr key={g.k} onClick={() => setBusca(g.k === "—" ? "" : g.k)} title="Clique para ver só esses pedidos" style={{ cursor: "pointer" }}>
                      <td><b>{g.k}</b></td><td className="n">{g.qtd}</td><td className="n">{g.m}</td><td className="n">{g.l}</td>
                      <td className="n"><span className="bk-dias" style={{ background: faixaDe(Math.round(g.media))?.cor }}>{dec1(g.media)}</span></td>
                      <td className="n">{g.max}</td><td className="n">{g.atraso || ""}</td>
                      <td className="n">{num(g.peso)}</td><td className="n">{moeda(g.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {aba === "SAIRAM" && (
        <>
          <div className="cabecalho-pagina">
            <div className="acoes">
              <label className="campo-data">Saíram de<input type="date" value={saiuDe} onChange={(e) => setSaiuDe(e.target.value)} /></label>
              <label className="campo-data">até<input type="date" value={saiuAte} onChange={(e) => setSaiuAte(e.target.value)} /></label>
              <button className="btn mini" onClick={() => todasDatas(1)}>Hoje</button>
              <button className="btn mini" onClick={() => todasDatas(7)}>7 dias</button>
              <button className="btn mini" onClick={() => todasDatas(30)}>30 dias</button>
            </div>
          </div>
          <section className="ag-funil bk-kpis">
            <div className="ag-etapa et-entregue"><span>Saíram da carteira</span><b>{sTot.qtd} <small>pedidos</small></b><em className="ag-valor">{moeda(sTot.valor)}</em><em>{num(sTot.peso)} kg</em></div>
            <div className="ag-etapa bk-kpi-idade"><span>Ficaram na carteira</span><b>{dec1(sMedia)} <small>dias em média</small></b><em className="ag-valor">mais tempo: {baseSairam.reduce((m, p) => Math.max(m, p.dias || 0), 0)} dia(s)</em><em>da liberação até sumir do relatório</em></div>
            <div className="ag-etapa et-agendado"><span>Saíram em até 1 dia</span><b>{sAte1} <small>{sTot.qtd ? Math.round((sAte1 / sTot.qtd) * 100) : 0}%</small></b><em className="ag-valor">{sTot.qtd - sAte1} levaram 2 dias ou mais</em></div>
            <div className="ag-etapa bk-kpi-m"><span>Saíram como montado</span><b>{baseSairam.filter((p) => p.posicao_saida === "M").length}</b><em>separados / faturados</em></div>
            <div className="ag-etapa ag-falta"><span>Saíram ainda liberados</span><b>{baseSairam.filter((p) => p.posicao_saida === "L").length}</b><em>sem passar por montado — conferir (cancelados?)</em></div>
          </section>
        </>
      )}

      {aba === "HIST" ? (
        <section className="cartao sem-pad">
          <div className="tabela-rolagem">
            <table className="bk-hist">
              <thead><tr><th>Quando</th><th>Por</th><th className="n">Na carteira</th><th className="n">Montados (M)</th><th className="n">Liberados (L)</th><th className="n">Valor</th><th className="n">Peso</th><th className="n">Entraram</th><th className="n">Saíram</th></tr></thead>
              <tbody>
                {colagens.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDataHora(c.quando)}</td><td>{c.usuario || "—"}</td>
                    <td className="n"><b>{c.qtd_l + c.qtd_m}</b></td><td className="n">{c.qtd_m}</td><td className="n">{c.qtd_l}</td>
                    <td className="n">{moeda(Number(c.valor_l) + Number(c.valor_m))}</td><td className="n">{num(Number(c.peso_l) + Number(c.peso_m))}</td>
                    <td className="n t-verde">{c.entraram ? `+${c.entraram}` : ""}</td><td className="n t-laranja">{c.sairam ? `−${c.sairam}` : ""}</td>
                  </tr>
                ))}
                {!colagens.length && <tr><td colSpan={9} className="vazio">Nenhuma colagem ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="cartao sem-pad">
          <div className="barra-tabela">
            <div className="linha-acoes">
              <input className="campo" placeholder="Buscar pedido, cliente, praça, RCA, carregamento…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 280 }} />
              {(filtroPos || filtroFaixa || busca) && aba === "CARTEIRA" && (
                <button className="btn link" onClick={() => { setFiltroPos(""); setFiltroFaixa(""); setBusca(""); }}>✕ limpar ({[filtroPos && POS[filtroPos].rot, filtroFaixa && FAIXAS.find((x) => x.k === filtroFaixa).rot, busca].filter(Boolean).join(" · ")})</button>
              )}
              {f.ativos > 0 && <button className="btn link" onClick={f.limparTudo}>✕ limpar filtros</button>}
            </div>
            <div className="linha-acoes">
              <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
              <span className="sub">{visiveis.length} pedido(s)</span>
            </div>
          </div>
          {carregando ? <div className="carregando">Carregando…</div> : !lista.length ? (
            <div className="vazio">{aba === "SAIRAM" ? "Nenhum pedido saiu da carteira nesse período." : <>Carteira vazia. Clique em <b>Colar liberados do Winthor</b>.</>}</div>
          ) : (
            <div className="tabela-rolagem">
              <table ref={refTabela} data-tabela={`backlog-${aba}`} className="bk">
                <thead>
                  <tr>
                    <ThFiltro f={f} col="pos" linhas={lista}>{aba === "SAIRAM" ? "Saiu como" : "Posição"}</ThFiltro>
                    <ThFiltro f={f} col="dias" linhas={lista} className="n">{aba === "SAIRAM" ? "Ficou (dias)" : "Dias"}</ThFiltro>
                    <ThFiltro f={f} col="lib" linhas={lista}>Liberado</ThFiltro>
                    {aba === "SAIRAM" && <ThFiltro f={f} col="saiu" linhas={lista}>Saiu</ThFiltro>}
                    <ThFiltro f={f} col="numped" linhas={lista}>Pedido</ThFiltro>
                    <ThFiltro f={f} col="cliente" linhas={lista}>Cliente</ThFiltro>
                    <ThFiltro f={f} col="cidade" linhas={lista}>Cidade</ThFiltro>
                    <ThFiltro f={f} col="praca" linhas={lista}>Praça</ThFiltro>
                    <ThFiltro f={f} col="supervisor" linhas={lista}>Supervisor</ThFiltro>
                    <ThFiltro f={f} col="rca" linhas={lista}>RCA</ThFiltro>
                    <ThFiltro f={f} col="peso" linhas={lista} className="n">KG</ThFiltro>
                    <ThFiltro f={f} col="valor" linhas={lista} className="n">Valor</ThFiltro>
                    <ThFiltro f={f} col="carreg" linhas={lista}>Carregamento</ThFiltro>
                    <th>Montado em</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => {
                    const pos = aba === "SAIRAM" ? p.posicao_saida : p.posicao;
                    const fx = faixaDe(p.dias);
                    return (
                      <tr key={p.id}>
                        <td><span className={`bk-pos ${POS[pos]?.classe || ""}`} title={POS[pos]?.dica}>{POS[pos]?.rot || pos || "—"}</span></td>
                        <td className="n"><span className="bk-dias" style={{ background: fx?.cor }} title={fx?.rot}>{p.dias ?? "—"}</span></td>
                        <td className="c-data">{p.data_liberacao ? fmtData(p.data_liberacao).slice(0, 5) : "—"}{p.hora_liberacao ? <small className="sub"> {p.hora_liberacao}</small> : ""}</td>
                        {aba === "SAIRAM" && <td className="c-data">{fmtDataHora(p.saiu_em)}</td>}
                        <td className="ag-ped">{p.numped}</td>
                        <td className="ag-cli" title={p.cliente}>{p.cliente}</td>
                        <td>{p.cidade}</td>
                        <td>{p.praca}</td>
                        <td>{p.supervisor}</td>
                        <td>{p.rca}</td>
                        <td className="n">{num(p.peso)}</td>
                        <td className="n">{moeda(p.valor)}</td>
                        <td>{p.carregamento}{p.placa ? <small className="sub"> · {p.placa}</small> : ""}</td>
                        <td className="c-data">{p.montado_em ? fmtDataHora(p.montado_em) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={aba === "SAIRAM" ? 10 : 9}>TOTAL · {visiveis.length} pedido(s) · média {dec1(media(visiveis, (p) => p.dias))} dia(s)</td>
                    <td className="n">{num(somar(visiveis).peso)}</td>
                    <td className="n">{moeda(somar(visiveis).valor)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
