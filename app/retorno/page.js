"use client";

import { useEffect, useState } from "react";
import { sb } from "../../lib/supabase";
import { useDataDaUrl, useTempoReal } from "../../lib/hooks";
import { useUsuario } from "../../components/Casca";
import CampoEditavel from "../../components/CampoEditavel";
import { useColunas } from "../../lib/colunas";
import { fmtData, fmtHora, fmtDataHora, num } from "../../lib/util";

export default function Retorno() {
  const { email } = useUsuario();
  const [data, setData] = useDataDaUrl();
  const [modo, setModo] = useState("data"); // "data" | "emrota"
  const [linhas, setLinhas] = useState([]);
  const [aSair, setASair] = useState(0);
  const [antigasEmRota, setAntigasEmRota] = useState(0);
  const [filtro, setFiltro] = useState("todos"); // todos | pendentes | retornados
  const [carregando, setCarregando] = useState(true);
  const [refTabela, ajustarColunas] = useColunas(`retorno-${modo}`, `${carregando}-${linhas.length}-${filtro}-${linhas.filter((l) => l.status === "RETORNOU").length}`);

  async function carregar() {
    if (!data) return;
    let q = sb().from("saidas").select("*");
    q = modo === "emrota" ? q.eq("status", "EM_ROTA") : q.eq("data", data).in("status", ["EM_ROTA", "RETORNOU"]);
    const [r, p, a] = await Promise.all([
      q.order("data").order("hora_saida", { ascending: true, nullsFirst: false }).order("ordem"),
      sb().from("saidas").select("id", { count: "exact", head: true }).eq("data", data).eq("status", "PROGRAMADO"),
      sb().from("saidas").select("id", { count: "exact", head: true }).lt("data", data).eq("status", "EM_ROTA"),
    ]);
    setLinhas(r.data || []);
    setASair(p.count || 0);
    setAntigasEmRota(a.count || 0);
    setCarregando(false);
  }
  useEffect(() => { setCarregando(true); carregar(); }, [data, modo]);
  useTempoReal(carregar, [data, modo]);

  async function atualizar(id, campos) {
    const antes = linhas.find((l) => l.id === id);
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...campos } : l)));
    const { error } = await sb().from("saidas").update(campos).eq("id", id);
    if (error) {
      setLinhas((ls) => ls.map((l) => (l.id === id ? antes : l)));
      throw error;
    }
  }

  async function checkout(l) {
    try { await atualizar(l.id, { status: "RETORNOU", checkout_em: new Date().toISOString(), checkout_por: email }); }
    catch (e) { alert(e.message); }
  }
  async function desfazer(l) {
    if (!confirm(`Desfazer o checkout de ${l.placa}?`)) return;
    try { await atualizar(l.id, { status: "EM_ROTA", checkout_em: null, checkout_por: null }); }
    catch (e) { alert(e.message); }
  }

  if (!data) return <div className="carregando">Carregando…</div>;

  const retornaram = linhas.filter((l) => l.status === "RETORNOU");
  const pendentes = linhas.filter((l) => l.status === "EM_ROTA");
  const celulares = linhas.filter((l) => l.celular_devolvido).length;
  const soma = (c) => linhas.reduce((s, l) => s + (Number(l[c]) || 0), 0);
  const visiveis = linhas.filter((l) => filtro === "todos" || (filtro === "pendentes" ? l.status === "EM_ROTA" : l.status === "RETORNOU"));

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Painel de retorno de entregas</h1>
          <p className="sub">Monitoramento: registre cancelados, reentregas, pendentes e celular, e dê o checkout quando o veículo voltar. Atualiza sozinho para todos.</p>
        </div>
        <div className="acoes">
          <div className="alternar">
            <button className={modo === "data" ? "ativo" : ""} onClick={() => setModo("data")}>Por data</button>
            <button className={modo === "emrota" ? "ativo" : ""} onClick={() => setModo("emrota")}>Todos em rota</button>
          </div>
          {modo === "data" && (
            <label className="campo-data">Data
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          )}
        </div>
      </div>

      {modo === "data" && antigasEmRota > 0 && (
        <div className="alerta aviso">
          Há <b>{antigasEmRota}</b> veículo(s) de datas anteriores ainda sem checkout.{" "}
          <button className="btn link" onClick={() => setModo("emrota")}>Ver todos em rota</button>
        </div>
      )}
      {modo === "data" && aSair > 0 && (
        <div className="alerta info">{aSair} veículo(s) do frete de {fmtData(data)} ainda sem horário de saída — eles aparecem aqui quando a saída for registrada.</div>
      )}

      <section className="kpis">
        <div className="kpi verde"><span>Retornou</span><b>{retornaram.length}</b></div>
        <div className="kpi laranja"><span>Pendente (em rota)</span><b>{pendentes.length}</b></div>
        <div className="kpi"><span>Celulares devolvidos</span><b>{celulares} / {linhas.length}</b></div>
        <div className="kpi"><span>Cancelados</span><b>{num(soma("cancelados"))}</b></div>
        <div className="kpi"><span>Reentregas</span><b>{num(soma("reentregas"))}</b></div>
        <div className="kpi"><span>Entregas pendentes</span><b>{num(soma("pendentes"))}</b></div>
      </section>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="alternar">
            {[["todos", "Todos"], ["pendentes", "Em rota"], ["retornados", "Retornados"]].map(([k, r]) => (
              <button key={k} className={filtro === k ? "ativo" : ""} onClick={() => setFiltro(k)}>{r}</button>
            ))}
          </div>
          <div className="linha-acoes"><button className="btn link" title="Volta as colunas para o auto ajuste" onClick={ajustarColunas}>↔ ajustar colunas</button><span className="sub">{visiveis.length} veículo(s)</span></div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : visiveis.length === 0 ? (
          <div className="vazio">Nenhum veículo {modo === "emrota" ? "em rota" : `saiu em ${fmtData(data)}`}.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="retorno" ref={refTabela}>
              <thead>
                <tr>
                  {modo === "emrota" && <th>Data</th>}
                  <th>Placa</th><th>Trans</th><th className="n">Entrega</th><th className="n">KG</th><th>Motorista</th><th>Entregador</th>
                  <th>Destino</th><th>Saída</th><th className="n">Cancel.</th><th className="n">Reentr.</th><th className="n">Pend.</th><th>Celular</th><th>Checkout</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const ok = l.status === "RETORNOU";
                  return (
                    <tr key={l.id} className={ok ? "l-verde" : ""}>
                      {modo === "emrota" && <td>{fmtData(l.data).slice(0, 5)}</td>}
                      <td className="placa">{l.placa}</td>
                      <td>{l.transportadora}</td>
                      <td className="n">{l.entregas}</td>
                      <td className="n">{num(l.kg)}</td>
                      <td>{l.motorista}</td>
                      <td>{l.entregador}</td>
                      <td>{l.destino}</td>
                      <td>{fmtHora(l.hora_saida)}</td>
                      <td className="n"><CampoEditavel tipo="number" min={0} largura="4em" className="n" valor={l.cancelados || ""} aoSalvar={(v) => atualizar(l.id, { cancelados: v })} /></td>
                      <td className="n"><CampoEditavel tipo="number" min={0} largura="4em" className="n" valor={l.reentregas || ""} aoSalvar={(v) => atualizar(l.id, { reentregas: v })} /></td>
                      <td className="n"><CampoEditavel tipo="number" min={0} largura="4em" className="n" valor={l.pendentes || ""} aoSalvar={(v) => atualizar(l.id, { pendentes: v })} /></td>
                      <td className="c">
                        <input type="checkbox" checked={!!l.celular_devolvido} onChange={(e) => atualizar(l.id, { celular_devolvido: e.target.checked }).catch((er) => alert(er.message))} />
                      </td>
                      <td className="checkout">
                        {ok ? (
                          <div>
                            <b className="t-verde">OK</b> {fmtHora(l.checkout_em)}
                            <small title={`${fmtDataHora(l.checkout_em)} · ${l.checkout_por || ""}`}>{(l.checkout_por || "").split("@")[0]}</small>
                            <button className="btn link" onClick={() => desfazer(l)}>desfazer</button>
                          </div>
                        ) : (
                          <button className="btn primario mini" onClick={() => checkout(l)}>Checkout</button>
                        )}
                      </td>
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
