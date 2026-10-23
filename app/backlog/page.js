"use client";

import { useEffect, useMemo, useState } from "react";
import { sb } from "../../lib/supabase";
import { useTempoReal } from "../../lib/hooks";
import { useColunas } from "../../lib/colunas";
import { useUsuario } from "../../components/Casca";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { lerLiberados, lerMontados, textoParaMatriz, comparar, SITUACOES, faixaDe } from "../../lib/backlog";
import { hojeISO, fmtData, fmtDataHora, num, moeda, baixarCSV } from "../../lib/util";

// Backlog: cola os LIBERADOS (carteira) e os MONTADOS, os dois do Winthor, e compara:
// qual liberado foi montado, qual ainda não foi, e quais carregamentos antigos continuam na carteira.

const TIPOS = {
  LIBERADOS: { tit: "1. Liberados (carteira)", dica: "Relatório de LIBERADOS do Winthor inteiro, com o cabeçalho (NUMPED, POSICAO, DATA…)", ler: lerLiberados, exemplo: "NUMPED	CODCLI	NUMNOTA	CODFILIAL	NOMECLIENTE	POSICAO	DATA	…" },
  MONTADOS: { tit: "2. Montados", dica: "Pedidos montados do Winthor, com o cabeçalho (NUMPED, NUMCAR, data, placa…)", ler: lerMontados, exemplo: "NUMCAR	NUMPED	DTSAIDA	PLACA	…" },
};
const somar = (l) => ({ qtd: l.length, peso: l.reduce((s, p) => s + (Number(p.peso) || 0), 0), valor: l.reduce((s, p) => s + (Number(p.valor) || 0), 0) });
const ORDEM_SIT = { BACKLOG: 0, NAO_MONTADO: 1, MONTADO: 2 };
const dm = (iso) => (iso ? fmtData(iso).slice(0, 5) : "—");

const COLUNAS = {
  sit: { valor: (p) => SITUACOES[p.situacao].rot },
  dias: { valor: (p) => p.dias, numero: true },
  lib: { valor: (p) => p.data_liberacao || "" },
  numped: { valor: (p) => p.numped },
  cliente: { valor: (p) => p.cliente },
  cidade: { valor: (p) => p.cidade },
  praca: { valor: (p) => p.praca },
  supervisor: { valor: (p) => p.supervisor },
  rca: { valor: (p) => p.rca },
  carreg: { valor: (p) => p.carregamento },
  placa: { valor: (p) => p.placa },
  peso: { valor: (p) => p.peso, numero: true },
  valor: { valor: (p) => p.valor, numero: true },
};

function CaixaColagem({ tipo, ultima, salvando, aoSalvar }) {
  const T = TIPOS[tipo];
  const [aberta, setAberta] = useState(false);
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const leitura = useMemo(() => (arquivo ? arquivo.leitura : texto.trim() ? T.ler(textoParaMatriz(texto)) : null), [texto, arquivo]);

  async function lerArquivo(e) {
    const arq = e.target.files?.[0];
    if (!arq) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true });
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    setArquivo({ nome: arq.name, leitura: T.ler(matriz) }); setTexto(""); setAberta(true);
    e.target.value = "";
  }
  async function salvar() {
    if (await aoSalvar(tipo, leitura.pedidos)) { setTexto(""); setArquivo(null); setAberta(false); }
  }
  const t = leitura?.pedidos ? somar(leitura.pedidos) : null;

  return (
    <section className={`cartao bk-caixa ${ultima ? "" : "vazia"}`}>
      <div className="bk-caixa-topo">
        <b>{T.tit}</b>
        <div className="linha-acoes">
          <button className="btn mini" onClick={() => setAberta(!aberta)}>{aberta ? "Fechar" : "Colar"}</button>
          <label className="btn mini">Enviar arquivo<input type="file" accept=".xls,.xlsx,.csv" onChange={lerArquivo} hidden /></label>
        </div>
      </div>
      <div className="sub">
        {ultima
          ? <>Última: <b>{fmtDataHora(ultima.quando)}</b>{ultima.usuario ? ` por ${ultima.usuario}` : ""} · <b>{ultima.qtd}</b> pedidos · {moeda(ultima.valor)} · {num(ultima.peso)} kg</>
          : <>Ainda não colado. {T.dica}.</>}
      </div>
      {aberta && (
        <>
          <textarea className="colar" rows={4} value={texto} onChange={(e) => { setTexto(e.target.value); setArquivo(null); }} placeholder={T.exemplo} />
          <div className="linha-acoes">
            {arquivo && <span className="sub">{arquivo.nome}</span>}
            {leitura && (leitura.erro ? <span className="t-vermelho">{leitura.erro}</span> : (
              <span>
                <b>{t.qtd}</b> {tipo === "MONTADOS" && leitura.porCarregamento ? "carregamento(s)" : "pedido(s)"} · {moeda(t.valor)} · {num(t.peso)} kg
                {tipo === "LIBERADOS" && <> · {leitura.pedidos.filter((p) => p.posicao === "M").length} M · {leitura.pedidos.filter((p) => p.posicao !== "M").length} L</>}
                {tipo === "MONTADOS" && <> · {new Set(leitura.pedidos.map((p) => p.carregamento).filter(Boolean)).size} carregamento(s)</>}
                {leitura.ignoradas > 0 && <small className="sub"> ({leitura.ignoradas} linha(s) de total ignorada(s))</small>}
                {leitura.naoAtendidos > 0 && <small className="sub"> ({leitura.naoAtendidos} "não atendido" fora)</small>}
              </span>
            ))}
            <button className="btn primario" disabled={!leitura?.pedidos?.length || salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </>
      )}
    </section>
  );
}

export default function Backlog() {
  const { email } = useUsuario();
  const [ultimas, setUltimas] = useState({ LIBERADOS: null, MONTADOS: null });
  const [carregando, setCarregando] = useState(true);
  const [semTabela, setSemTabela] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dataRef, setDataRef] = useState(hojeISO());
  const [sit, setSit] = useState("");
  const [carreg, setCarreg] = useState("");
  const [busca, setBusca] = useState("");
  const [verSairam, setVerSairam] = useState(false);
  const f = useFiltros(COLUNAS);

  async function carregar() {
    const [l, m] = await Promise.all(["LIBERADOS", "MONTADOS"].map((t) =>
      sb().from("backlog_colagens").select("*").eq("tipo", t).order("quando", { ascending: false }).limit(1)));
    if (l.error || m.error) setSemTabela(/backlog|relation|schema cache/i.test((l.error || m.error).message || ""));
    else { setSemTabela(false); setUltimas({ LIBERADOS: l.data?.[0] || null, MONTADOS: m.data?.[0] || null }); }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useTempoReal(carregar, []);

  async function salvar(tipo, pedidos) {
    setSalvando(true);
    const t = somar(pedidos);
    const { error } = await sb().from("backlog_colagens").insert({ tipo, usuario: email || null, qtd: t.qtd, peso: t.peso, valor: t.valor, dados: pedidos });
    setSalvando(false);
    if (error) { setMsg({ tipo: "erro", txt: error.message }); return false; }
    setMsg({ tipo: "ok", txt: `${tipo === "LIBERADOS" ? "Liberados" : "Montados"} salvos: ${t.qtd} pedidos.` });
    setCarreg(""); carregar();
    return true;
  }

  const lib = ultimas.LIBERADOS?.dados || [];
  const mon = ultimas.MONTADOS?.dados || [];
  const cmp = useMemo(() => comparar(lib, mon, dataRef), [ultimas, dataRef]);
  const por = (s) => cmp.pedidos.filter((p) => p.situacao === s);
  const tot = somar(cmp.pedidos), tM = somar(por("MONTADO")), tN = somar(por("NAO_MONTADO")), tB = somar(por("BACKLOG")), tS = somar(cmp.sairam);
  const maisAntigo = cmp.carregamentos[0]?.dias || 0;

  // aviso: colagens de dias diferentes
  const diaL = ultimas.LIBERADOS?.quando && new Date(ultimas.LIBERADOS.quando).toLocaleDateString("sv-SE", { timeZone: "America/Manaus" });
  const diaM = ultimas.MONTADOS?.quando && new Date(ultimas.MONTADOS.quando).toLocaleDateString("sv-SE", { timeZone: "America/Manaus" });

  const b = busca.trim().toUpperCase();
  const lista = cmp.pedidos
    .filter((p) => (!sit || p.situacao === sit) && (!carreg || p.carregamento === carreg)
      && (!b || [p.numped, p.cliente, p.cidade, p.praca, p.rca, p.supervisor, p.carregamento, p.placa].some((x) => String(x || "").includes(b))))
    .sort((a, c) => ORDEM_SIT[a.situacao] - ORDEM_SIT[c.situacao] || (c.dias ?? -1) - (a.dias ?? -1) || String(a.carregamento).localeCompare(String(c.carregamento)));
  const visiveis = f.aplicar(lista);
  const [refTabela, ajustarColunas] = useColunas("backlog-pedidos", `${carregando}-${visiveis.length}`);

  function exportar() {
    baixarCSV(`backlog_${dataRef}.csv`, ["SITUACAO", "DIAS", "LIBERADO", "PEDIDO", "CLIENTE", "CIDADE", "PRACA", "SUPERVISOR", "RCA", "CARREGAMENTO", "PLACA", "PESO", "VALOR"],
      visiveis.map((p) => [SITUACOES[p.situacao].rot, p.dias ?? "", fmtData(p.data_liberacao), p.numped, p.cliente, p.cidade, p.praca, p.supervisor, p.rca, p.carregamento, p.placa,
        String(p.peso).replace(".", ","), String(p.valor).replace(".", ",")]));
  }
  const kpi = (k, rot, t, extra) => (
    <button className={`ag-etapa ${SITUACOES[k]?.classe ? `bk-kpi-${k}` : ""} ${sit === k ? "sel" : ""}`} onClick={() => { setSit(sit === k ? "" : k); setCarreg(""); }} title={SITUACOES[k]?.dica}>
      <span>{rot}</span><b>{t.qtd} <small>pedidos</small></b>
      <em className="ag-valor">{moeda(t.valor)}</em><em>{num(t.peso)} kg{extra ? ` · ${extra}` : ""}</em>
    </button>
  );

  return (
    <>
      <div className="cabecalho-pagina">
        <h1 className="titulo-pagina">Backlog <small className="sub">liberados × montados</small></h1>
        <div className="acoes">
          <label className="campo-data" title="Dia da montagem: carregamentos de dias anteriores que ainda estão na carteira viram backlog">
            Data de referência<input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value || hojeISO())} />
          </label>
        </div>
      </div>

      {semTabela && <div className="alerta aviso">Rode o arquivo <b>17_backlog.sql</b> no Supabase (SQL Editor › Run) para ativar o Backlog.</div>}
      {msg && <div className={`alerta ${msg.tipo}`} onClick={() => setMsg(null)}>{msg.txt}</div>}

      <div className="bk-caixas">
        <CaixaColagem tipo="LIBERADOS" ultima={ultimas.LIBERADOS} salvando={salvando} aoSalvar={salvar} />
        <CaixaColagem tipo="MONTADOS" ultima={ultimas.MONTADOS} salvando={salvando} aoSalvar={salvar} />
      </div>

      {lib.length > 0 && !mon.length && <div className="alerta aviso">Cole os <b>montados</b> para separar o que foi montado agora do que é carregamento antigo (backlog).</div>}
      {diaL && diaM && diaL !== diaM && <div className="alerta aviso">Atenção: os liberados são de {dm(diaL)} e os montados de {dm(diaM)}. Cole os dois do mesmo dia para a comparação ficar certa.</div>}

      {lib.length > 0 && (
        <>
          <section className="ag-funil bk-kpis">
            <button className={`ag-etapa et-montado ${!sit ? "sel" : ""}`} onClick={() => { setSit(""); setCarreg(""); }}>
              <span>Liberados na carteira</span><b>{tot.qtd} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(tot.valor)}</em><em>{num(tot.peso)} kg</em>
            </button>
            {kpi("MONTADO", "Montados", tM, tot.qtd ? `${Math.round((tM.qtd / tot.qtd) * 100)}% dos liberados` : "")}
            {kpi("NAO_MONTADO", "Não montados", tN)}
            {kpi("BACKLOG", "Backlog · carregamento antigo", tB, `${cmp.carregamentos.length} carreg. · até ${maisAntigo} dia(s)`)}
            <button className={`ag-etapa et-entregue ${verSairam ? "sel" : ""}`} onClick={() => setVerSairam(!verSairam)} title="Pedidos dos montados que não estão mais nos liberados: já foram separados / faturados">
              <span>Montados fora da carteira</span><b>{tS.qtd} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(tS.valor)}</em><em>já separados / faturados</em>
            </button>
          </section>

          {verSairam && cmp.sairam.length > 0 && (
            <section className="cartao bk-sairam">
              <b>Montados que já saíram da carteira</b> <span className="sub">({cmp.sairam.length})</span>
              <div className="bk-lista-peds">{cmp.sairam.map((m) => <span key={m.numped} title={`${m.cliente} · carreg. ${m.carregamento}`}>{m.numped}</span>)}</div>
            </section>
          )}

          {cmp.carregamentos.length > 0 && (
            <section className="cartao sem-pad bk-cars">
              <div className="barra-tabela">
                <b className="t-vermelho">Carregamentos antigos ainda na carteira (backlog)</b>
                <span className="sub">clique num carregamento para ver os pedidos</span>
              </div>
              <div className="tabela-rolagem">
                <table className="bk-agr">
                  <thead><tr><th>Carregamento</th><th>Placa</th><th>Destino</th><th>Montado em</th><th>Liberação mais antiga</th><th className="n">Dias na carteira</th><th className="n">Pedidos</th><th className="n">Peso</th><th className="n">Valor</th></tr></thead>
                  <tbody>
                    {cmp.carregamentos.map((g) => (
                      <tr key={g.carregamento} className={carreg === g.carregamento ? "sel" : ""} onClick={() => { setCarreg(carreg === g.carregamento ? "" : g.carregamento); setSit(""); }} style={{ cursor: "pointer" }}>
                        <td><b>{g.carregamento}</b></td><td>{g.placa || "—"}</td><td>{g.destino || "—"}</td>
                        <td>{g.data_carga ? dm(g.data_carga) : <span className="sub">não está nos montados</span>}</td>
                        <td>{dm(g.libMaisAntiga)}</td>
                        <td className="n"><span className="bk-dias" style={{ background: faixaDe(g.dias)?.cor }}>{g.dias}</span></td>
                        <td className="n">{g.pedidos.length}</td><td className="n">{num(g.peso)}</td><td className="n">{moeda(g.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={6}>TOTAL · {cmp.carregamentos.length} carregamento(s)</td><td className="n">{tB.qtd}</td><td className="n">{num(tB.peso)}</td><td className="n">{moeda(tB.valor)}</td></tr></tfoot>
                </table>
              </div>
            </section>
          )}

          <section className="cartao sem-pad">
            <div className="barra-tabela">
              <div className="linha-acoes">
                <input className="campo" placeholder="Buscar pedido, cliente, praça, RCA, carregamento…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 280 }} />
                {(sit || carreg || busca) && (
                  <button className="btn link" onClick={() => { setSit(""); setCarreg(""); setBusca(""); }}>
                    ✕ limpar ({[sit && SITUACOES[sit].rot, carreg && `carreg. ${carreg}`, busca].filter(Boolean).join(" · ")})
                  </button>
                )}
                {f.ativos > 0 && <button className="btn link" onClick={f.limparTudo}>✕ limpar filtros</button>}
              </div>
              <div className="linha-acoes">
                <button className="btn link" onClick={exportar}>⭳ Excel (CSV)</button>
                <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
                <span className="sub">{visiveis.length} pedido(s)</span>
              </div>
            </div>
            <div className="tabela-rolagem">
              <table ref={refTabela} data-tabela="backlog-pedidos" className="bk">
                <thead>
                  <tr>
                    <ThFiltro f={f} col="sit" linhas={lista}>Situação</ThFiltro>
                    <ThFiltro f={f} col="dias" linhas={lista} className="n">Dias</ThFiltro>
                    <ThFiltro f={f} col="lib" linhas={lista}>Liberado</ThFiltro>
                    <ThFiltro f={f} col="numped" linhas={lista}>Pedido</ThFiltro>
                    <ThFiltro f={f} col="cliente" linhas={lista}>Cliente</ThFiltro>
                    <ThFiltro f={f} col="cidade" linhas={lista}>Cidade</ThFiltro>
                    <ThFiltro f={f} col="praca" linhas={lista}>Praça</ThFiltro>
                    <ThFiltro f={f} col="supervisor" linhas={lista}>Supervisor</ThFiltro>
                    <ThFiltro f={f} col="rca" linhas={lista}>RCA</ThFiltro>
                    <ThFiltro f={f} col="carreg" linhas={lista}>Carregamento</ThFiltro>
                    <ThFiltro f={f} col="placa" linhas={lista}>Placa</ThFiltro>
                    <ThFiltro f={f} col="peso" linhas={lista} className="n">KG</ThFiltro>
                    <ThFiltro f={f} col="valor" linhas={lista} className="n">Valor</ThFiltro>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => {
                    const S = SITUACOES[p.situacao];
                    return (
                      <tr key={p.numped}>
                        <td><span className={`bk-pos ${S.classe}`} title={S.dica}>{S.rot}</span></td>
                        <td className="n"><span className="bk-dias" style={{ background: faixaDe(p.dias)?.cor }}>{p.dias ?? "—"}</span></td>
                        <td className="c-data">{dm(p.data_liberacao)}{p.hora_liberacao ? <small className="sub"> {p.hora_liberacao}</small> : ""}</td>
                        <td className="ag-ped">{p.numped}</td>
                        <td className="ag-cli" title={p.cliente}>{p.cliente}</td>
                        <td>{p.cidade}</td>
                        <td>{p.praca}</td>
                        <td>{p.supervisor}</td>
                        <td>{p.rca}</td>
                        <td>{p.carregamento || "—"}</td>
                        <td>{p.placa}</td>
                        <td className="n">{num(p.peso)}</td>
                        <td className="n">{moeda(p.valor)}</td>
                      </tr>
                    );
                  })}
                  {!visiveis.length && <tr><td colSpan={13} className="vazio">Nenhum pedido com esse filtro.</td></tr>}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={11}>TOTAL · {visiveis.length} pedido(s)</td>
                    <td className="n">{num(somar(visiveis).peso)}</td>
                    <td className="n">{moeda(somar(visiveis).valor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
      {!lib.length && !carregando && !semTabela && <div className="vazio cartao">Cole os <b>liberados</b> e os <b>montados</b> do Winthor para ver a comparação.</div>}
    </>
  );
}
