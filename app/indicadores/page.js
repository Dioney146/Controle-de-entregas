"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import { useUsuario } from "../../components/Casca";
import { hojeISO, somarDias, fmtData, num, moeda, normPlaca } from "../../lib/util";

// Indicadores: do que foi PROGRAMADO (Frete / Saídas), quanto foi ENTREGUE, quanto voltou como
// REENTREGA (site de Transferências) e quanto foi DEVOLVIDO (site de Devoluções) — em pedidos, valor e peso.
// Entregue = programado − reentregas − devolvidos.

const CAT = {
  ENTREGUE: { rot: "Entregue", cor: "#15803d" },
  REENTREGA: { rot: "Reentrega", cor: "#0369a1" },
  DEVOLVIDO: { rot: "Devolvido", cor: "#b91c1c" },
};
const ORDEM = ["ENTREGUE", "REENTREGA", "DEVOLVIDO"];
const METRICAS = { pedidos: "Pedidos", valor: "Valor", peso: "Peso (kg)" };
const fmt = (m, v) => (m === "valor" ? moeda(v) : m === "peso" ? `${num(v)} kg` : num(v));
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const fpct = (a, b) => (b > 0 ? `${pct(a, b).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const dm = (iso) => (iso ? fmtData(iso).slice(0, 5) : "—");
const zero = () => ({ pedidos: 0, valor: 0, peso: 0 });

// pedidos de devolução/reentrega: cada nota conta uma vez; valor e peso somam todas as linhas
function somarNotas(lista, chave) {
  const notas = new Set();
  const t = zero();
  for (const l of lista) {
    const k = chave(l);
    if (k && !notas.has(k)) { notas.add(k); t.pedidos++; }
    t.valor += l.valor || 0; t.peso += l.peso || 0;
  }
  return t;
}
const chaveDev = (l) => l.nota_venda || l.nota_devolucao;
// reentregas contam CLIENTES (código do cliente) por dia, não notas: um cliente com 5 NFs é 1 reentrega
const chaveRe = (l) => `${l.data}|${l.codcli || l.cliente || l.numnota || l.numped}`;

function inicioDoMes(iso) { return `${iso.slice(0, 8)}01`; }

export default function Indicadores() {
  const { email } = useUsuario();
  const hoje = hojeISO();
  const [de, setDe] = useState(inicioDoMes(hoje));
  const [ate, setAte] = useState(hoje);
  const [baseDev, setBaseDev] = useState("dt_entrega");
  const [metrica, setMetrica] = useState("pedidos");
  const [saidas, setSaidas] = useState([]);
  const [ext, setExt] = useState({ reentregas: [], devolucoes: [], erros: {} });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const ultimaBusca = useRef(0);
  async function carregar() {
    if (!de || !ate || de > ate) return;
    const minha = ++ultimaBusca.current; // ao trocar a data rápido, só vale a resposta da última busca
    setCarregando(true); setErro("");
    try {
      const [s, r] = await Promise.all([
        buscarTudo(() => sb().from("saidas").select("id, data, placa, placa_original, transportadora, entregas, kg, valor, destino, zona, motorista, entregador").gte("data", de).lte("data", ate).order("data").order("id")),
        fetch(`/api/indicadores?de=${de}&ate=${ate}`, { headers: { "x-usuario": encodeURIComponent(email || "site") }, cache: "no-store" })
          .then(async (x) => { const j = await x.json().catch(() => ({})); if (!x.ok) throw new Error(j.erro || `erro ${x.status}`); return j; }),
      ]);
      if (minha !== ultimaBusca.current) return;
      setSaidas(s); setExt({ reentregas: r.reentregas || [], devolucoes: r.devolucoes || [], erros: r.erros || {} });
    } catch (e) { if (minha === ultimaBusca.current) setErro(e.message || String(e)); }
    if (minha === ultimaBusca.current) setCarregando(false);
  }
  useEffect(() => { carregar(); }, [de, ate]);

  const dentro = (d) => d && d >= de && d <= ate;
  const devs = useMemo(() => ext.devolucoes.filter((l) => dentro(l[baseDev])).map((l) => ({ ...l, data: l[baseDev] })), [ext, baseDev, de, ate]);
  const rees = ext.reentregas;

  // transportadora pela placa (para reentregas e devoluções sem transportadora)
  const transDaPlaca = useMemo(() => {
    const m = new Map();
    for (const s of saidas) { if (s.transportadora) { m.set(normPlaca(s.placa), s.transportadora); if (s.placa_original) m.set(normPlaca(s.placa_original), s.transportadora); } }
    return m;
  }, [saidas]);

  const prog = useMemo(() => saidas.reduce((t, s) => ({ pedidos: t.pedidos + (Number(s.entregas) || 0), valor: t.valor + (Number(s.valor) || 0), peso: t.peso + (Number(s.kg) || 0) }), zero()), [saidas]);
  const tR = somarNotas(rees, chaveRe), tD = somarNotas(devs, chaveDev);
  const entregue = { pedidos: Math.max(0, prog.pedidos - tR.pedidos - tD.pedidos), valor: Math.max(0, prog.valor - tR.valor - tD.valor), peso: Math.max(0, prog.peso - tR.peso - tD.peso) };
  const tot = { ENTREGUE: entregue, REENTREGA: tR, DEVOLVIDO: tD };

  // por dia
  const dias = useMemo(() => {
    const m = new Map();
    const dia = (d) => { if (!m.has(d)) m.set(d, { d, prog: zero(), re: [], dev: [] }); return m.get(d); };
    for (const s of saidas) { const g = dia(s.data); g.prog.pedidos += Number(s.entregas) || 0; g.prog.valor += Number(s.valor) || 0; g.prog.peso += Number(s.kg) || 0; }
    for (const l of rees) dia(l.data).re.push(l);
    for (const l of devs) dia(l.data).dev.push(l);
    return [...m.values()].sort((a, b) => a.d.localeCompare(b.d)).map((g) => {
      const r = somarNotas(g.re, chaveRe), v = somarNotas(g.dev, chaveDev);
      const e = { pedidos: Math.max(0, g.prog.pedidos - r.pedidos - v.pedidos), valor: Math.max(0, g.prog.valor - r.valor - v.valor), peso: Math.max(0, g.prog.peso - r.peso - v.peso) };
      return { d: g.d, prog: g.prog, ENTREGUE: e, REENTREGA: r, DEVOLVIDO: v };
    });
  }, [saidas, rees, devs]);

  // por transportadora
  const porTrans = useMemo(() => {
    const m = new Map();
    const g = (t) => { const k = t || "SEM TRANSPORTADORA"; if (!m.has(k)) m.set(k, { k, prog: zero(), re: [], dev: [] }); return m.get(k); };
    for (const s of saidas) { const x = g(s.transportadora); x.prog.pedidos += Number(s.entregas) || 0; x.prog.valor += Number(s.valor) || 0; x.prog.peso += Number(s.kg) || 0; }
    for (const l of rees) g(transDaPlaca.get(l.placa)).re.push(l);
    for (const l of devs) g(transDaPlaca.get(l.placa) || (/NÃO IDENT/.test(l.transportadora) ? "" : l.transportadora)).dev.push(l);
    return [...m.values()].map((x) => {
      const r = somarNotas(x.re, chaveRe), v = somarNotas(x.dev, chaveDev);
      return { k: x.k, prog: x.prog, REENTREGA: r, DEVOLVIDO: v, ENTREGUE: { pedidos: Math.max(0, x.prog.pedidos - r.pedidos - v.pedidos), valor: Math.max(0, x.prog.valor - r.valor - v.valor), peso: Math.max(0, x.prog.peso - r.peso - v.peso) } };
    }).filter((x) => x.prog.pedidos || x.prog.valor || x.REENTREGA.pedidos || x.DEVOLVIDO.pedidos).sort((a, b) => b.prog.valor - a.prog.valor);
  }, [saidas, rees, devs, transDaPlaca]);

  // cargas (veículo do frete no dia) com reentregas / devoluções
  const cargasRe = useMemo(() => porCarga(rees, saidas, chaveRe, (l) => [l.placa]), [rees, saidas]);
  const cargasDev = useMemo(() => porCarga(devs, saidas, chaveDev, (l) => [l.placa_retorno, l.placa]), [devs, saidas]);

  const motivos = (lista, chave) => {
    const m = new Map();
    for (const l of lista) { const k = l.motivo || "SEM MOTIVO"; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return [...m.entries()].map(([k, ls]) => ({ k, ...somarNotas(ls, chave) })).sort((a, b) => b[metrica] - a[metrica]);
  };
  const motDev = motivos(devs, chaveDev), motRe = motivos(rees, chaveRe);

  const atalho = (d1, d2) => { setDe(d1); setAte(d2); };

  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Indicadores <small className="sub">programado × entregue × reentrega × devolvido</small></h1>
      </div>

      <section className="cartao ind-filtros">
        <div className="linha-acoes">
          <label className="campo-data">De<input type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
          <label className="campo-data">até<input type="date" value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
          <div className="linha-acoes ind-atalhos">
            <button className={`btn mini ${de === hoje && ate === hoje ? "primario" : ""}`} onClick={() => atalho(hoje, hoje)}>Hoje</button>
            <button className={`btn mini ${de === somarDias(hoje, -1) && ate === somarDias(hoje, -1) ? "primario" : ""}`} onClick={() => atalho(somarDias(hoje, -1), somarDias(hoje, -1))}>Ontem</button>
            <button className={`btn mini ${de === somarDias(hoje, -6) && ate === hoje ? "primario" : ""}`} onClick={() => atalho(somarDias(hoje, -6), hoje)}>7 dias</button>
            <button className={`btn mini ${de === inicioDoMes(hoje) && ate === hoje ? "primario" : ""}`} onClick={() => atalho(inicioDoMes(hoje), hoje)}>Este mês</button>
          </div>
          <button className="btn link" onClick={carregar} disabled={carregando}>{carregando ? "Carregando…" : "↻ Atualizar"}</button>
        </div>
        <div className="linha-acoes">
          <span className="sub">Devoluções pela</span>
          <button className={`btn mini ${baseDev === "dt_entrega" ? "primario" : ""}`} onClick={() => setBaseDev("dt_entrega")} title="Dia em que o veículo saiu para entregar (bate com a programação)">data de entrega</button>
          <button className={`btn mini ${baseDev === "dt_entrada" ? "primario" : ""}`} onClick={() => setBaseDev("dt_entrada")} title="Dia em que a devolução deu entrada">data de entrada</button>
          <span className="sub" style={{ marginLeft: 12 }}>Gráficos por</span>
          {Object.entries(METRICAS).map(([k, t]) => <button key={k} className={`btn mini ${metrica === k ? "primario" : ""}`} onClick={() => setMetrica(k)}>{t}</button>)}
        </div>
      </section>

      {erro && <div className="alerta erro">{erro}</div>}
      {ext.erros.reentregas && <div className="alerta aviso">Não deu para buscar as reentregas no site de Transferências: {ext.erros.reentregas}</div>}
      {ext.erros.devolucoes && <div className="alerta aviso">Não deu para buscar as devoluções no site de Devoluções: {ext.erros.devolucoes}</div>}

      <section className="ind-cards">
        <div className="ind-card ind-prog">
          <span className="ind-rot">Programado</span>
          <b>{num(prog.pedidos)} <small>pedidos</small></b>
          <em>{moeda(prog.valor)}</em><em>{num(prog.peso)} kg</em>
          <small className="sub">{saidas.length} veículo(s) no frete · {dm(de)} a {dm(ate)}</small>
        </div>
        {ORDEM.map((k) => (
          <div key={k} className="ind-card" style={{ borderTopColor: CAT[k].cor }}>
            <span className="ind-rot"><i style={{ background: CAT[k].cor }} />{CAT[k].rot}</span>
            <b>{fpct(tot[k][metrica], prog[metrica])} <small>{metrica === "pedidos" && k === "REENTREGA" ? "clientes" : METRICAS[metrica].toLowerCase()}</small></b>
            {k === "REENTREGA" && <small className="sub">{rees.length} nota(s) fiscal(is) de {num(tR.pedidos)} cliente(s)</small>}
            <table className="ind-mini">
              <tbody>
                <tr><td>{k === "REENTREGA" ? "Clientes" : "Pedidos"}</td><td className="n">{num(tot[k].pedidos)}</td><td className="n">{fpct(tot[k].pedidos, prog.pedidos)}</td></tr>
                <tr><td>Valor</td><td className="n">{moeda(tot[k].valor)}</td><td className="n">{fpct(tot[k].valor, prog.valor)}</td></tr>
                <tr><td>Peso</td><td className="n">{num(tot[k].peso)} kg</td><td className="n">{fpct(tot[k].peso, prog.peso)}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="cartao ind-comp">
        <div className="ind-tit"><b>Composição do programado</b><Legenda /></div>
        {Object.entries(METRICAS).map(([m, t]) => <Barra100 key={m} rotulo={t} total={prog[m]} partes={ORDEM.map((k) => ({ k, v: tot[k][m] }))} m={m} />)}
        {!prog.pedidos && !carregando && <div className="vazio">Nenhum veículo no frete entre {dm(de)} e {dm(ate)}.</div>}
      </section>

      <div className="ind-grade">
        <section className="cartao ind-dias">
          <div className="ind-tit"><b>Dia a dia · {METRICAS[metrica].toLowerCase()}</b><Legenda /></div>
          {dias.map((g) => (
            <Barra100 key={g.d} rotulo={dm(g.d)} total={g.prog[metrica]} partes={ORDEM.map((k) => ({ k, v: g[k][metrica] }))} m={metrica} extra={fmt(metrica, g.prog[metrica])} />
          ))}
          {!dias.length && <div className="vazio">Sem dados no período.</div>}
        </section>

        <section className="cartao ind-trans">
          <div className="ind-tit"><b>Por transportadora</b><span className="sub">% do programado de cada uma · {METRICAS[metrica].toLowerCase()}</span></div>
          <table className="ind-tab">
            <thead><tr><th>Transportadora</th><th className="n">Programado</th><th className="n">Entregue</th><th className="n">Reentrega</th><th className="n">Devolvido</th></tr></thead>
            <tbody>
              {porTrans.map((t) => (
                <tr key={t.k}>
                  <td><b>{t.k}</b></td>
                  <td className="n">{fmt(metrica, t.prog[metrica])}</td>
                  <td className="n" style={{ color: CAT.ENTREGUE.cor }}>{fpct(t.ENTREGUE[metrica], t.prog[metrica])}</td>
                  <td className="n" title={fmt(metrica, t.REENTREGA[metrica])}>{fpct(t.REENTREGA[metrica], t.prog[metrica])}</td>
                  <td className="n" title={fmt(metrica, t.DEVOLVIDO[metrica])}>{fpct(t.DEVOLVIDO[metrica], t.prog[metrica])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="cartao">
          <div className="ind-tit"><span className="ind-rot"><i style={{ background: CAT.DEVOLVIDO.cor }} /></span><b>Motivos de devolução</b><span className="sub">{METRICAS[metrica].toLowerCase()}</span></div>
          <Barras linhas={motDev} m={metrica} cor={CAT.DEVOLVIDO.cor} />
        </section>

        <section className="cartao">
          <div className="ind-tit"><span className="ind-rot"><i style={{ background: CAT.REENTREGA.cor }} /></span><b>Motivos de reentrega</b><span className="sub">{METRICAS[metrica].toLowerCase()}</span></div>
          <Barras linhas={motRe} m={metrica} cor={CAT.REENTREGA.cor} />
        </section>
      </div>

      <TabelaCargas titulo="Cargas com mais reentregas" cor={CAT.REENTREGA.cor} cargas={cargasRe} rotulo="Clientes reentrega" unidade="cliente(s)" chave={chaveRe} />
      <TabelaCargas titulo="Cargas com mais devoluções" cor={CAT.DEVOLVIDO.cor} cargas={cargasDev} rotulo="Devoluções" chave={chaveDev} devolucao />

      <p className="sub ind-nota">
        Programado = veículos do Frete / Saídas no período (pedidos = entregas da programação). Reentregas = clientes (pelo código do cliente) com notas registradas no site de
        Transferências, por dia de registro — um cliente com várias NFs no mesmo dia conta uma vez. Devoluções = notas do site de Devoluções pela {baseDev === "dt_entrega" ? "data de entrega" : "data de entrada"}.
        Cada nota de venda devolvida conta como um pedido. Entregue = programado − reentregas − devolvidos.
      </p>
    </>
  );
}

function Legenda() {
  return (
    <span className="ind-leg">
      {ORDEM.map((k) => <span key={k}><i style={{ background: CAT[k].cor }} />{CAT[k].rot}</span>)}
    </span>
  );
}

// barra 100% (entregue | reentrega | devolvido) com o % escrito dentro de cada parte
function Barra100({ rotulo, total, partes, m, extra }) {
  return (
    <div className="ind-b100">
      <span className="ind-b100-rot">{rotulo}</span>
      <span className="ind-b100-trilho">
        {total > 0 && partes.filter((p) => p.v > 0).map((p) => {
          const w = Math.min(100, pct(p.v, total));
          return (
            <i key={p.k} style={{ width: `${w}%`, background: CAT[p.k].cor }} title={`${CAT[p.k].rot}: ${fmt(m, p.v)} (${fpct(p.v, total)})`}>
              {w >= 7 ? fpct(p.v, total) : ""}
            </i>
          );
        })}
      </span>
      <span className="ind-b100-val">{extra ?? fmt(m, total)}</span>
    </div>
  );
}

// barras horizontais (top 8 + "Outros")
function Barras({ linhas, m, cor }) {
  let rows = linhas;
  if (rows.length > 8) {
    const resto = rows.slice(7);
    rows = [...rows.slice(0, 7), { k: `Outros (${resto.length})`, outros: true, pedidos: resto.reduce((s, x) => s + x.pedidos, 0), valor: resto.reduce((s, x) => s + x.valor, 0), peso: resto.reduce((s, x) => s + x.peso, 0) }];
  }
  if (!rows.length) return <div className="vazio">Nada no período.</div>;
  const topo = Math.max(1, ...rows.filter((r) => !r.outros).map((r) => r[m]));
  return (
    <div className="bk-barras">
      {rows.map((r) => (
        <div key={r.k} className="bk-barra-linha" title={`${r.k}\n${r.pedidos} pedido(s) · ${moeda(r.valor)} · ${num(r.peso)} kg`}>
          <span className="bk-barra-rot">{r.k}</span>
          <span className="bk-barra-trilho"><i style={{ width: `${Math.min(100, (r[m] / topo) * 100)}%`, background: r.outros ? "#98a2b3" : cor }} /></span>
          <span className="bk-barra-val">{fmt(m, r[m])}{m !== "pedidos" && <small> · {r.pedidos} ped.</small>}</span>
        </div>
      ))}
    </div>
  );
}

// junta as notas (reentregas ou devoluções) na carga de onde saíram: placa + dia no Frete / Saídas.
// Procura pela placa atual e pela placa original (troca de placa); se não achar no dia, usa a saída
// mais recente dessa placa antes da data, dentro do período.
function porCarga(lista, saidas, chave, placasDe) {
  const idx = new Map(); // placa -> saídas (ordenadas por data)
  for (const s of saidas) for (const p of [normPlaca(s.placa), normPlaca(s.placa_original)]) {
    if (!p) continue;
    if (!idx.has(p)) idx.set(p, []);
    idx.get(p).push(s);
  }
  const cargas = new Map();
  for (const l of lista) {
    let s = null;
    for (const p of placasDe(l).map(normPlaca).filter(Boolean)) {
      const cand = idx.get(p) || [];
      s = cand.find((x) => x.data === l.data) || [...cand].reverse().find((x) => x.data <= l.data) || null;
      if (s) break;
    }
    const placa = s ? normPlaca(s.placa) : placasDe(l).map(normPlaca).find(Boolean) || "—";
    const k = s ? `s${s.id}` : `x${placa}|${l.data}`;
    if (!cargas.has(k)) cargas.set(k, { k, saida: s, data: s ? s.data : l.data, placa, notas: [] });
    cargas.get(k).notas.push(l);
  }
  return [...cargas.values()].map((c) => {
    const t = somarNotas(c.notas, chave);
    const s = c.saida || {};
    const um = (campo) => c.notas.map((n) => n[campo]).find(Boolean) || "";
    return {
      ...c, ...t,
      transportadora: s.transportadora || um("transportadora") || "—",
      destino: s.destino || s.zona || um("destino") || "—",
      entregas: c.saida ? Number(s.entregas) || 0 : null,
      motorista: s.motorista || um("motorista") || "",
      entregador: s.entregador || um("entregador") || "",
      trocada: c.saida && s.placa_original ? normPlaca(s.placa_original) : "",
    };
  }).sort((a, b) => b.pedidos - a.pedidos || b.valor - a.valor);
}

function TabelaCargas({ titulo, cor, cargas, rotulo, chave, devolucao, unidade = "nota(s)" }) {
  const [aberta, setAberta] = useState(null);
  const [todas, setTodas] = useState(false);
  const lista = todas ? cargas : cargas.slice(0, 15);
  const tot = cargas.reduce((t, c) => ({ pedidos: t.pedidos + c.pedidos, valor: t.valor + c.valor }), { pedidos: 0, valor: 0 });
  return (
    <section className="cartao sem-pad ind-cargas" style={{ borderTopColor: cor }}>
      <div className="barra-tabela">
        <div className="ind-tit" style={{ margin: 0 }}><span className="ind-rot"><i style={{ background: cor }} /></span><b>{titulo}</b>
          <span className="sub">{cargas.length} carga(s) · {tot.pedidos} {unidade}{devolucao ? "" : ` (${cargas.reduce((n, c) => n + c.notas.length, 0)} NFs)`} · {moeda(tot.valor)} · clique numa carga para ver as notas</span></div>
      </div>
      {!cargas.length ? <div className="vazio">Nenhuma {devolucao ? "devolução" : "reentrega"} no período.</div> : (
        <div className="tabela-rolagem">
          <table className="ind-tab ind-tab-cargas">
            <thead><tr>
              <th>Data</th><th>Transportadora</th><th>Placa</th><th>Destino</th>
              <th className="n">Entregas prog.</th><th className="n">{rotulo}</th><th className="n">% das entregas</th><th className="n">Valor</th>
              <th>Motorista</th><th>Entregador</th>
            </tr></thead>
            <tbody>
              {lista.map((c) => (
                <FragCarga key={c.k} c={c} cor={cor} aberta={aberta === c.k} alternar={() => setAberta(aberta === c.k ? null : c.k)} devolucao={devolucao} chave={chave} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cargas.length > 15 && <div className="ind-mais"><button className="btn link" onClick={() => setTodas(!todas)}>{todas ? "mostrar só as 15 primeiras" : `ver todas as ${cargas.length} cargas`}</button></div>}
    </section>
  );
}

function FragCarga({ c, cor, aberta, alternar, devolucao, chave }) {
  const p = c.entregas ? c.pedidos / c.entregas : null;
  const notas = [...new Map(c.notas.map((n) => [chave(n) + "|" + (n.nota_devolucao || ""), n])).values()];
  return (
    <>
      <tr className={`ind-carga ${aberta ? "aberta" : ""}`} onClick={alternar}>
        <td>{dm(c.data)}</td>
        <td><b>{c.transportadora}</b></td>
        <td><b>{c.placa}</b>{c.trocada ? <small className="sub"> (era {c.trocada})</small> : ""}</td>
        <td>{c.destino}</td>
        <td className="n">{c.entregas != null ? num(c.entregas) : <span className="sub" title="Placa não encontrada no Frete / Saídas do período">—</span>}</td>
        <td className="n"><span className="ind-qtd" style={{ background: cor }}>{c.pedidos}</span></td>
        <td className="n">{p != null ? `${(p * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}</td>
        <td className="n">{moeda(c.valor)}</td>
        <td>{c.motorista || <span className="sub">—</span>}</td>
        <td>{c.entregador || <span className="sub">—</span>}</td>
      </tr>
      {aberta && notas.map((n, i) => (
        <tr key={i} className="ind-carga-nota">
          <td></td>
          <td colSpan={3}>{devolucao ? `NF venda ${n.nota_venda || "—"}${n.nota_devolucao ? ` · dev. ${n.nota_devolucao}` : ""}` : `NF ${n.numnota || "—"}`} · <b>{n.cliente}</b></td>
          <td colSpan={2} className="sub">{n.motivo || "sem motivo"}</td>
          <td></td>
          <td className="n">{moeda(n.valor)}</td>
          <td colSpan={2} className="sub">{devolucao ? `entrada ${dm(n.dt_entrada)}` : n.bairro || ""}</td>
        </tr>
      ))}
    </>
  );
}
