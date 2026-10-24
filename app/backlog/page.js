"use client";

import { useMemo, useState } from "react";
import { lerRelatorio, textoParaMatriz, comparar, somar, corDias } from "../../lib/backlog";
import { hojeISO, fmtData, num, moeda, baixarCSV } from "../../lib/util";

// Backlog (painel simples, sem gravar nada): cola os LIBERADOS e os MONTADOS do Winthor e mostra
//  - os carregamentos montados em dias anteriores que ainda não terminaram a separação (principal)
//  - os liberados que ficaram fora da roteirização (não estão nos montados)

// guarda o que foi colado enquanto o site estiver aberto (trocar de aba não perde)
const memoria = { LIBERADOS: null, MONTADOS: null };
const dm = (iso) => (iso ? fmtData(iso).slice(0, 5) : "—");
const br = (n) => String(Math.round((n || 0) * 100) / 100).replace(".", ",");

function Colagem({ tipo, titulo, valor, aoMudar }) {
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);

  function lerTexto(t) {
    setTexto(t);
    aoMudar(t.trim() ? { origem: "colado", ...lerRelatorio(textoParaMatriz(t)) } : null);
  }
  async function lerArquivo(e) {
    const arq = e.target.files?.[0];
    e.target.value = "";
    if (!arq) return;
    setLendo(true);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await arq.arrayBuffer(), { type: "array", cellDates: true });
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    setTexto("");
    aoMudar({ origem: arq.name, ...lerRelatorio(matriz) });
    setLendo(false);
  }
  const t = valor?.pedidos ? somar(valor.pedidos) : null;

  return (
    <section className={`cartao bk-caixa ${valor?.pedidos?.length ? "" : "vazia"}`}>
      <div className="bk-caixa-topo">
        <b>{titulo}</b>
        <div className="linha-acoes">
          <label className="btn mini">{lendo ? "Lendo…" : "Enviar arquivo"}<input type="file" accept=".xls,.xlsx,.csv" onChange={lerArquivo} hidden /></label>
          {valor && <button className="btn mini" onClick={() => { setTexto(""); aoMudar(null); }}>Limpar</button>}
        </div>
      </div>
      {valor?.pedidos?.length ? (
        <div className="bk-caixa-ok">
          <b>{t.qtd}</b> pedidos · {moeda(t.valor)} · {num(t.peso)} kg
          <small className="sub"> · {valor.origem === "colado" ? "colado" : valor.origem}{valor.ignoradas ? ` · ${valor.ignoradas} linha(s) de total ignorada(s)` : ""}</small>
        </div>
      ) : valor?.erro ? <div className="t-vermelho">{valor.erro}</div> : null}
      {!valor?.pedidos?.length ? (
        <textarea className="colar" rows={3} value={texto} onChange={(e) => lerTexto(e.target.value)}
          placeholder={`Cole aqui o ${tipo} do Winthor com o cabeçalho (NUMPED, CODCLI, … PLACA) ou envie o arquivo .xls`} />
      ) : null}
    </section>
  );
}

export default function Backlog() {
  const [lib, setLib] = useState(memoria.LIBERADOS);
  const [mon, setMon] = useState(memoria.MONTADOS);
  const [hoje, setHoje] = useState(hojeISO());
  const [aba, setAba] = useState("BACKLOG");
  const [aberto, setAberto] = useState(null);

  const mudarLib = (v) => { memoria.LIBERADOS = v; setLib(v); };
  const mudarMon = (v) => { memoria.MONTADOS = v; setMon(v); };
  const pronto = lib?.pedidos?.length && mon?.pedidos?.length;
  const r = useMemo(() => (pronto ? comparar(lib.pedidos, mon.pedidos, hoje) : null), [lib, mon, hoje, pronto]);

  const tB = r ? somar(r.antigos) : null, tF = r ? somar(r.fora) : null, tR = r ? somar(r.roteirizados) : null;

  function exportarBacklog() {
    baixarCSV(`backlog_carregamentos_${hoje}.csv`, ["CARREGAMENTO", "PLACA", "DESTINO", "DATA MAIS ANTIGA", "DIAS", "PEDIDO", "CLIENTE", "DATA", "PESO", "VALOR"],
      r.carregamentos.flatMap((c) => c.pedidos.map((p) => [c.carregamento, c.placa, c.destino, fmtData(c.dataMin), c.dias, p.numped, p.cliente, fmtData(p.data), br(p.peso), br(p.valor)])));
  }
  function exportarFora() {
    baixarCSV(`fora_da_roteirizacao_${hoje}.csv`, ["PEDIDO", "CLIENTE", "DATA", "DIAS", "CIDADE", "PRACA", "RCA", "SUPERVISOR", "PESO", "VALOR"],
      r.fora.map((p) => [p.numped, p.cliente, fmtData(p.data), p.dias, p.cidade, p.praca, p.rca, p.supervisor, br(p.peso), br(p.valor)]));
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Backlog <small className="sub">liberados × montados</small></h1>
        <div className="acoes">
          <label className="campo-data" title="Pedidos montados com DATA de hoje entraram hoje na carteira e são desconsiderados">
            Hoje<input type="date" value={hoje} onChange={(e) => setHoje(e.target.value || hojeISO())} />
          </label>
        </div>
      </div>

      <div className="bk-caixas">
        <Colagem tipo="LIBERADOS_AM" titulo="1. Liberados" valor={lib} aoMudar={mudarLib} />
        <Colagem tipo="MONTADOS_AM" titulo="2. Montados" valor={mon} aoMudar={mudarMon} />
      </div>

      {!pronto ? (
        <div className="vazio cartao">Cole (ou envie) os <b>liberados</b> e os <b>montados</b> para ver a comparação. Nada é gravado — o painel mostra só o que você colar.</div>
      ) : (
        <>
          <section className="ag-funil bk-kpis">
            <button className={`ag-etapa bk-kpi-BACKLOG ${aba === "BACKLOG" ? "sel" : ""}`} onClick={() => setAba("BACKLOG")}>
              <span>Montados antigos sem separar</span>
              <b>{r.carregamentos.length} <small>carregamentos · {tB.qtd} pedidos</small></b>
              <em className="ag-valor">{moeda(tB.valor)}</em><em>{num(tB.peso)} kg · montados até {dm(r.carregamentos.at(-1)?.dataMax)}</em>
            </button>
            <button className={`ag-etapa bk-kpi-NAO_MONTADO ${aba === "FORA" ? "sel" : ""}`} onClick={() => setAba("FORA")}>
              <span>Liberados fora da roteirização</span>
              <b>{tF.qtd} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(tF.valor)}</em><em>{num(tF.peso)} kg · não estão nos montados</em>
            </button>
            <div className="ag-etapa bk-kpi-MONTADO" style={{ cursor: "default" }}>
              <span>Liberados roteirizados</span>
              <b>{tR.qtd} <small>de {lib.pedidos.length} ({Math.round((tR.qtd / lib.pedidos.length) * 100)}%)</small></b>
              <em className="ag-valor">{moeda(tR.valor)}</em><em>{num(tR.peso)} kg</em>
            </div>
            <div className="ag-etapa" style={{ cursor: "default" }}>
              <span>Montados de hoje fora dos liberados</span>
              <b>{r.deHoje.length} <small>pedidos</small></b>
              <em className="ag-valor">{moeda(somar(r.deHoje).valor)}</em><em>entraram hoje ({dm(hoje)}) · desconsiderados</em>
            </div>
          </section>

          {aba === "BACKLOG" ? (
            <section className="cartao sem-pad bk-cars">
              <div className="barra-tabela">
                <div><b className="t-vermelho">Carregamentos montados antes de {dm(hoje)} que ainda não finalizaram a separação</b>
                  <span className="sub"> · clique para ver os pedidos</span></div>
                <button className="btn link" onClick={exportarBacklog}>⭳ Excel (CSV)</button>
              </div>
              <div className="tabela-rolagem">
                <table className="bk-agr">
                  <thead><tr><th>Carregamento</th><th>Placa</th><th>Destino</th><th>Data</th><th className="n">Dias</th><th className="n">Pedidos</th><th className="n">Peso (kg)</th><th className="n">Valor</th></tr></thead>
                  <tbody>
                    {r.carregamentos.map((c) => (
                      <FragmentoCarregamento key={c.carregamento} c={c} aberto={aberto === c.carregamento} alternar={() => setAberto(aberto === c.carregamento ? null : c.carregamento)} />
                    ))}
                    {!r.carregamentos.length && <tr><td colSpan={8} className="vazio">Nenhum carregamento antigo pendente. 👍</td></tr>}
                  </tbody>
                  <tfoot><tr><td colSpan={5}>TOTAL · {r.carregamentos.length} carregamento(s)</td><td className="n">{tB.qtd}</td><td className="n">{num(tB.peso)}</td><td className="n">{moeda(tB.valor)}</td></tr></tfoot>
                </table>
              </div>
            </section>
          ) : (
            <section className="cartao sem-pad">
              <div className="barra-tabela">
                <div><b>Liberados que não estão nos montados</b><span className="sub"> · não foram roteirizados</span></div>
                <button className="btn link" onClick={exportarFora}>⭳ Excel (CSV)</button>
              </div>
              <div className="tabela-rolagem">
                <table className="bk">
                  <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th className="n">Dias</th><th>Cidade</th><th>Praça</th><th>RCA</th><th>Supervisor</th><th className="n">Peso (kg)</th><th className="n">Valor</th></tr></thead>
                  <tbody>
                    {[...r.fora].sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.cliente.localeCompare(b.cliente)).map((p) => (
                      <tr key={p.numped}>
                        <td className="ag-ped">{p.numped}</td><td className="ag-cli" title={p.cliente}>{p.cliente}</td>
                        <td>{dm(p.data)}{p.hora ? <small className="sub"> {p.hora}</small> : ""}</td>
                        <td className="n"><span className="bk-dias" style={{ background: corDias(p.dias) }}>{p.dias ?? "—"}</span></td>
                        <td>{p.cidade}</td><td>{p.praca}</td><td>{p.rca}</td><td>{p.supervisor}</td>
                        <td className="n">{num(p.peso)}</td><td className="n">{moeda(p.valor)}</td>
                      </tr>
                    ))}
                    {!r.fora.length && <tr><td colSpan={10} className="vazio">Todos os liberados estão nos montados.</td></tr>}
                  </tbody>
                  <tfoot><tr><td colSpan={8}>TOTAL · {tF.qtd} pedido(s)</td><td className="n">{num(tF.peso)}</td><td className="n">{moeda(tF.valor)}</td></tr></tfoot>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function FragmentoCarregamento({ c, aberto, alternar }) {
  return (
    <>
      <tr className={aberto ? "sel" : ""} onClick={alternar} style={{ cursor: "pointer" }}>
        <td><b>{aberto ? "▾" : "▸"} {c.carregamento}</b></td>
        <td>{c.placa || "—"}</td>
        <td>{c.destino || "—"}</td>
        <td>{dm(c.dataMin)}{c.dataMax !== c.dataMin ? ` a ${dm(c.dataMax)}` : ""}</td>
        <td className="n"><span className="bk-dias" style={{ background: corDias(c.dias) }}>{c.dias}</span></td>
        <td className="n">{c.pedidos.length}</td>
        <td className="n">{num(c.peso)}</td>
        <td className="n">{moeda(c.valor)}</td>
      </tr>
      {aberto && c.pedidos.map((p) => (
        <tr key={p.numped} className="bk-sub">
          <td className="ag-ped">↳ {p.numped}</td>
          <td colSpan={2} className="ag-cli" title={p.cliente}>{p.cliente}{p.cidade ? <small className="sub"> · {p.cidade}</small> : ""}</td>
          <td>{dm(p.data)}{p.hora ? <small className="sub"> {p.hora}</small> : ""}</td>
          <td className="n">{p.dias}</td>
          <td></td>
          <td className="n">{num(p.peso)}</td>
          <td className="n">{moeda(p.valor)}</td>
        </tr>
      ))}
    </>
  );
}
