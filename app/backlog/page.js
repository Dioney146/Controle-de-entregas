"use client";

import { useMemo, useState } from "react";
import { lerRelatorio, textoParaMatriz, comparar, somar, corDias, agrupar, diasEntre, CATEGORIAS } from "../../lib/backlog";
import { hojeISO, fmtData, num, moeda, baixarCSV } from "../../lib/util";

// Backlog (painel simples, sem gravar nada): cola os LIBERADOS e os MONTADOS do Winthor e mostra
//  - os carregamentos montados em dias anteriores que ainda não terminaram a separação (principal)
//  - os liberados que ficaram fora da roteirização (não estão nos montados)

// guarda o que foi colado enquanto o site estiver aberto (trocar de aba não perde)
const memoria = { LIBERADOS: null, MONTADOS: null };
// carregamentos excluídos ficam guardados neste navegador (o nº do carregamento não se repete)
const CHAVE_EXCL = "backlog_excluidos";
function lerExcluidos() { try { return new Set(JSON.parse(localStorage.getItem(CHAVE_EXCL) || "[]")); } catch { return new Set(); } }
function gravarExcluidos(set) { try { localStorage.setItem(CHAVE_EXCL, JSON.stringify([...set].slice(-500))); } catch {} }
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
  const [vista, setVista] = useState("PAINEL");
  const [excl, setExcl] = useState(() => (typeof window === "undefined" ? new Set() : lerExcluidos()));
  const [sel, setSel] = useState(new Set());
  const [buscaCar, setBuscaCar] = useState("");

  const mudarLib = (v) => { memoria.LIBERADOS = v; setLib(v); };
  const mudarMon = (v) => { memoria.MONTADOS = v; setMon(v); };
  const pronto = lib?.pedidos?.length && mon?.pedidos?.length;
  const r = useMemo(() => (pronto ? comparar(lib.pedidos, mon.pedidos, hoje) : null), [lib, mon, hoje, pronto]);

  const carsAtivos = r ? r.carregamentos.filter((c) => !excl.has(c.carregamento)) : [];
  const carsExcl = r ? r.carregamentos.filter((c) => excl.has(c.carregamento)) : [];
  const antigos = carsAtivos.flatMap((c) => c.pedidos);
  const tB = r ? somar(antigos) : null, tF = r ? somar(r.fora) : null, tR = r ? somar(r.roteirizados) : null;
  const bc = buscaCar.trim().toUpperCase();
  const carsVisiveis = carsAtivos.filter((c) => !bc || [c.carregamento, c.placa, c.destino].some((x) => String(x || "").toUpperCase().includes(bc)));
  const todosMarcados = carsVisiveis.length > 0 && carsVisiveis.every((c) => sel.has(c.carregamento));

  function excluir(lista) {
    const n = new Set(excl); lista.forEach((k) => n.add(k));
    setExcl(n); gravarExcluidos(n); setSel(new Set()); setAberto(null);
  }
  function restaurar(lista) {
    const n = new Set(excl); lista.forEach((k) => n.delete(k));
    setExcl(n); gravarExcluidos(n);
  }
  function marcar(k) { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); setSel(n); }
  function marcarTodos() { setSel(todosMarcados ? new Set() : new Set(carsVisiveis.map((c) => c.carregamento))); }

  function exportarBacklog() {
    baixarCSV(`backlog_carregamentos_${hoje}.csv`, ["CARREGAMENTO", "PLACA", "DESTINO", "DATA MAIS ANTIGA", "DIAS", "PEDIDO", "CLIENTE", "DATA", "PESO", "VALOR"],
      carsAtivos.flatMap((c) => c.pedidos.map((p) => [c.carregamento, c.placa, c.destino, fmtData(c.dataMin), c.dias, p.numped, p.cliente, fmtData(p.data), br(p.peso), br(p.valor)])));
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

      {pronto ? (
        <div className="abas-pessoas">
          <button className={`aba-p ${vista === "PAINEL" ? "ativa" : ""}`} onClick={() => setVista("PAINEL")}>Painel</button>
          <button className={`aba-p ${vista === "DASH" ? "ativa" : ""}`} onClick={() => setVista("DASH")}>Dashboard</button>
        </div>
      ) : null}

      {pronto && vista === "DASH" ? (
        <Dashboard r={r} antigos={antigos} carsAtivos={carsAtivos} carsExcl={carsExcl} hoje={hoje} totLib={lib.pedidos.length} totMon={mon.pedidos.length} />
      ) : !pronto ? (
        <div className="vazio cartao">Cole (ou envie) os <b>liberados</b> e os <b>montados</b> para ver a comparação. Nada é gravado — o painel mostra só o que você colar.</div>
      ) : (
        <>
          <section className="ag-funil bk-kpis">
            <button className={`ag-etapa bk-kpi-BACKLOG ${aba === "BACKLOG" ? "sel" : ""}`} onClick={() => setAba("BACKLOG")}>
              <span>Montados antigos sem separar</span>
              <b>{carsAtivos.length} <small>carregamentos · {tB.qtd} pedidos</small></b>
              <em className="ag-valor">{moeda(tB.valor)}</em><em>{num(tB.peso)} kg{carsExcl.length ? ` · ${carsExcl.length} excluído(s)` : ""}</em>
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
              <div className="barra-tabela bk-acoes-car">
                <div className="linha-acoes">
                  <input className="campo" placeholder="Filtrar carregamento, placa ou destino…" value={buscaCar} onChange={(e) => { setBuscaCar(e.target.value); setSel(new Set()); }} style={{ minWidth: 260 }} />
                  {sel.size > 0 && (
                    <>
                      <button className="btn perigo-cheio mini" onClick={() => excluir([...sel])}>Excluir {sel.size} selecionado(s)</button>
                      <button className="btn link" onClick={() => setSel(new Set())}>desmarcar</button>
                    </>
                  )}
                </div>
                <span className="sub">{carsVisiveis.length} carregamento(s)</span>
              </div>
              <div className="tabela-rolagem">
                <table className="bk-agr">
                  <thead><tr>
                    <th className="bk-ck"><input type="checkbox" checked={todosMarcados} onChange={marcarTodos} title="Marcar todos" /></th>
                    <th>Carregamento</th><th>Placa</th><th>Destino</th><th>Data</th><th className="n">Dias</th><th className="n">Pedidos</th><th className="n">Peso (kg)</th><th className="n">Valor</th><th></th>
                  </tr></thead>
                  <tbody>
                    {carsVisiveis.map((c) => (
                      <FragmentoCarregamento key={c.carregamento} c={c} aberto={aberto === c.carregamento} alternar={() => setAberto(aberto === c.carregamento ? null : c.carregamento)}
                        marcado={sel.has(c.carregamento)} marcar={() => marcar(c.carregamento)} excluir={() => excluir([c.carregamento])} />
                    ))}
                    {!carsVisiveis.length && <tr><td colSpan={10} className="vazio">{bc ? "Nenhum carregamento com esse filtro." : "Nenhum carregamento antigo pendente. 👍"}</td></tr>}
                  </tbody>
                  <tfoot><tr><td colSpan={6}>TOTAL · {carsAtivos.length} carregamento(s)</td><td className="n">{tB.qtd}</td><td className="n">{num(tB.peso)}</td><td className="n">{moeda(tB.valor)}</td><td></td></tr></tfoot>
                </table>
              </div>
              {carsExcl.length > 0 && (
                <div className="bk-excluidos">
                  <span className="sub">Excluídos ({carsExcl.length}) — não entram nos totais nem no dashboard:</span>
                  {carsExcl.map((c) => (
                    <button key={c.carregamento} className="bk-chip-excl" onClick={() => restaurar([c.carregamento])} title={`${c.placa} · ${c.destino} · ${c.pedidos.length} pedido(s) · ${moeda(c.valor)} — clique para voltar`}>
                      {c.carregamento} <small>{c.destino}</small> ↺
                    </button>
                  ))}
                  <button className="btn link" onClick={() => restaurar(carsExcl.map((c) => c.carregamento))}>↺ restaurar todos</button>
                </div>
              )}
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

function FragmentoCarregamento({ c, aberto, alternar, marcado, marcar, excluir }) {
  const parar = (e) => e.stopPropagation();
  return (
    <>
      <tr className={`${aberto ? "sel" : ""} ${marcado ? "marcado" : ""}`} onClick={alternar} style={{ cursor: "pointer" }}>
        <td className="bk-ck" onClick={parar}><input type="checkbox" checked={marcado} onChange={marcar} /></td>
        <td><b>{aberto ? "▾" : "▸"} {c.carregamento}</b></td>
        <td>{c.placa || "—"}</td>
        <td>{c.destino || "—"}</td>
        <td>{dm(c.dataMin)}{c.dataMax !== c.dataMin ? ` a ${dm(c.dataMax)}` : ""}</td>
        <td className="n"><span className="bk-dias" style={{ background: corDias(c.dias) }}>{c.dias}</span></td>
        <td className="n">{c.pedidos.length}</td>
        <td className="n">{num(c.peso)}</td>
        <td className="n">{moeda(c.valor)}</td>
        <td className="bk-x" onClick={parar}><button className="btn-x" onClick={excluir} title="Excluir este carregamento do backlog">✕</button></td>
      </tr>
      {aberto && c.pedidos.map((p) => (
        <tr key={p.numped} className="bk-sub">
          <td></td>
          <td className="ag-ped">↳ {p.numped}</td>
          <td colSpan={2} className="ag-cli" title={p.cliente}>{p.cliente}{p.cidade ? <small className="sub"> · {p.cidade}</small> : ""}</td>
          <td>{dm(p.data)}{p.hora ? <small className="sub"> {p.hora}</small> : ""}</td>
          <td className="n">{p.dias}</td>
          <td></td>
          <td className="n">{num(p.peso)}</td>
          <td className="n">{moeda(p.valor)}</td>
          <td></td>
        </tr>
      ))}
    </>
  );
}

// ---------------- Dashboard ----------------
const METRICAS = { valor: "Valor", qtd: "Pedidos", peso: "Peso (kg)" };
const fmtMetrica = (m, v) => (m === "valor" ? moeda(v) : m === "peso" ? `${num(v)} kg` : `${num(v)}`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");

// barras horizontais de uma série (rótulo · barra · valor). Passando de `max` linhas, o resto vira "Outros".
function Barras({ linhas, metrica, cor, max = 10, rotulo = (g) => g.k }) {
  let rows = linhas;
  if (rows.length > max) {
    const resto = rows.slice(max - 1);
    rows = [...rows.slice(0, max - 1), { k: `Outros (${resto.length})`, outros: true, qtd: resto.reduce((s, g) => s + g.qtd, 0), peso: resto.reduce((s, g) => s + g.peso, 0), valor: resto.reduce((s, g) => s + g.valor, 0) }];
  }
  const topo = Math.max(1, ...rows.filter((g) => !g.outros).map((g) => g[metrica])); // "Outros" não define a escala
  if (!rows.length) return <div className="vazio">Nada nesta categoria.</div>;
  return (
    <div className="bk-barras">
      {rows.map((g) => (
        <div key={g.k} className="bk-barra-linha" title={`${g.outros ? g.k : rotulo(g)}\n${g.qtd} pedido(s) · ${moeda(g.valor)} · ${num(g.peso)} kg`}>
          <span className="bk-barra-rot">{g.outros ? g.k : rotulo(g)}</span>
          <span className="bk-barra-trilho"><i style={{ width: `${Math.min(100, (g[metrica] / topo) * 100)}%`, background: g.outros ? "#98a2b3" : cor }} /></span>
          <span className="bk-barra-val">{fmtMetrica(metrica, g[metrica])}{metrica !== "qtd" && <small> · {g.qtd} ped.</small>}</span>
        </div>
      ))}
    </div>
  );
}

function Painel({ cat, titulo, children }) {
  const C = CATEGORIAS[cat];
  return (
    <section className="cartao bk-painel">
      <div className="bk-painel-tit"><i style={{ background: C.cor }} /><b>{C.rot}</b><span className="sub"> · {titulo}</span></div>
      {children}
    </section>
  );
}

function Dashboard({ r, antigos, carsAtivos, carsExcl, hoje, totLib, totMon }) {
  const [m, setM] = useState("valor");
  const porData = (lista) => agrupar(lista, "data", m).sort((a, b) => String(a.k).localeCompare(String(b.k)));
  const cats = [
    { k: "BACKLOG", l: antigos, extra: `${carsAtivos.length} carregamento(s) · ${pct(antigos.length, totMon)} dos montados` },
    { k: "FORA", l: r.fora, extra: `${pct(r.fora.length, totLib)} dos liberados` },
    { k: "ROTEIRIZADOS", l: r.roteirizados, extra: `${pct(r.roteirizados.length, totLib)} dos liberados` },
    { k: "HOJE", l: r.deHoje, extra: `entraram em ${dm(hoje)} · desconsiderados` },
  ];
  const carsGrupo = carsAtivos.map((c) => ({ k: c.carregamento, placa: c.placa, destino: c.destino, qtd: c.pedidos.length, peso: c.peso, valor: c.valor }))
    .sort((a, b) => b[m] - a[m]);

  return (
    <>
      <div className="bk-dash-topo">
        <div className="linha-acoes">
          <span className="sub">Medir por</span>
          {Object.entries(METRICAS).map(([k, t]) => <button key={k} className={`btn mini ${m === k ? "primario" : ""}`} onClick={() => setM(k)}>{t}</button>)}
        </div>
        {carsExcl.length > 0 && <span className="sub">{carsExcl.length} carregamento(s) excluído(s) não entram no dashboard</span>}
      </div>

      <section className="bk-cats">
        {cats.map(({ k, l, extra }) => {
          const C = CATEGORIAS[k], t = somar(l);
          return (
            <div key={k} className="bk-cat" style={{ borderTopColor: C.cor }} title={C.dica}>
              <span className="bk-cat-rot"><i style={{ background: C.cor }} />{C.rot}</span>
              <b>{fmtMetrica(m, t[m])}</b>
              <em>{t.qtd} pedidos · {moeda(t.valor)} · {num(t.peso)} kg</em>
              <small>{extra}</small>
            </div>
          );
        })}
      </section>

      <div className="bk-grade">
        <Painel cat="BACKLOG" titulo="por data de montagem">
          <Barras linhas={porData(antigos)} metrica={m} cor={CATEGORIAS.BACKLOG.cor} rotulo={(g) => `${dm(g.k)} · há ${diasEntre(g.k, hoje)} dia(s)`} />
        </Painel>
        <Painel cat="BACKLOG" titulo="por destino">
          <Barras linhas={agrupar(antigos, "destino", m)} metrica={m} cor={CATEGORIAS.BACKLOG.cor} />
        </Painel>
        <Painel cat="BACKLOG" titulo="maiores carregamentos">
          <Barras linhas={carsGrupo} metrica={m} cor={CATEGORIAS.BACKLOG.cor} rotulo={(g) => `${g.k} · ${g.placa || "—"} · ${g.destino || "—"}`} />
        </Painel>
        <Painel cat="FORA" titulo="por data de liberação">
          <Barras linhas={porData(r.fora)} metrica={m} cor={CATEGORIAS.FORA.cor} rotulo={(g) => dm(g.k)} />
        </Painel>
        <Painel cat="FORA" titulo="por supervisor">
          <Barras linhas={agrupar(r.fora, "supervisor", m)} metrica={m} cor={CATEGORIAS.FORA.cor} />
        </Painel>
        <Painel cat="FORA" titulo="por praça">
          <Barras linhas={agrupar(r.fora, "praca", m)} metrica={m} cor={CATEGORIAS.FORA.cor} />
        </Painel>
        <Painel cat="FORA" titulo="por RCA">
          <Barras linhas={agrupar(r.fora, "rca", m)} metrica={m} cor={CATEGORIAS.FORA.cor} />
        </Painel>
        <Painel cat="ROTEIRIZADOS" titulo="por destino">
          <Barras linhas={agrupar(r.roteirizados, "destino", m)} metrica={m} cor={CATEGORIAS.ROTEIRIZADOS.cor} />
        </Painel>
        <Painel cat="HOJE" titulo="por destino">
          <Barras linhas={agrupar(r.deHoje, "destino", m)} metrica={m} cor={CATEGORIAS.HOJE.cor} />
        </Painel>
      </div>
    </>
  );
}

