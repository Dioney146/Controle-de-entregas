"use client";

import { useEffect, useState } from "react";
import { sb } from "../../lib/supabase";
import { useDataDaUrl, useTempoReal } from "../../lib/hooks";
import { useUsuario } from "../../components/Casca";
import CampoEditavel from "../../components/CampoEditavel";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { useColunas } from "../../lib/colunas";
import { fmtData, fmtHora, fmtDataHora, num, corTrans } from "../../lib/util";

const COLUNAS = {
  data: { valor: (l) => l.data },
  placa: { valor: (l) => l.placa },
  trans: { valor: (l) => l.transportadora },
  ent: { valor: (l) => l.entregas, numero: true },
  kg: { valor: (l) => l.kg, numero: true },
  motorista: { valor: (l) => l.motorista },
  entregador: { valor: (l) => l.entregador },
  destino: { valor: (l) => l.destino },
  saida: { valor: (l) => (l.hora_saida ? fmtHora(l.hora_saida) : "A SAIR") },
  cancel: { valor: (l) => l.cancelados || 0, numero: true },
  reent: { valor: (l) => l.reentregas || 0, numero: true },
  pend: { valor: (l) => l.pendentes || 0, numero: true },
  celular: { valor: (l) => (l.celular_devolvido ? "DEVOLVIDO" : "NÃO") },
  checkout: { valor: (l) => (l.status === "RETORNOU" ? "OK" : "PENDENTE") },
};

export default function Retorno() {
  const { email } = useUsuario();
  const [data, setData] = useDataDaUrl();
  const [modo, setModo] = useState("data"); // "data" | "emrota"
  const [linhas, setLinhas] = useState([]);
  const [aSair, setASair] = useState(0);
  const [antigasEmRota, setAntigasEmRota] = useState(0);
  const [filtro, setFiltro] = useState("todos"); // todos | pendentes | retornados
  const [carregando, setCarregando] = useState(true);
  const f = useFiltros(COLUNAS);
  const [refTabela, ajustarColunas] = useColunas(`retorno-${modo}`, `${carregando}-${linhas.length}-${filtro}-${linhas.filter((l) => l.status === "RETORNOU").length}`);

  async function carregar() {
    if (!data) return;
    let q = sb().from("saidas").select("*");
    // espelho do Frete/Saídas: aparece assim que o frete é gerado (não precisa ter saída registrada)
    q = modo === "emrota" ? q.neq("status", "RETORNOU") : q.eq("data", data);
    const [r, p, a] = await Promise.all([
      q.order("data").order("ordem").order("id"),
      sb().from("saidas").select("id", { count: "exact", head: true }).eq("data", data).eq("status", "PROGRAMADO"),
      sb().from("saidas").select("id", { count: "exact", head: true }).lt("data", data).neq("status", "RETORNOU"),
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
    try { await atualizar(l.id, { status: l.hora_saida ? "EM_ROTA" : "PROGRAMADO", checkout_em: null, checkout_por: null }); }
    catch (e) { alert(e.message); }
  }

  if (!data) return <div className="carregando">Carregando…</div>;

  const retornaram = linhas.filter((l) => l.status === "RETORNOU");
  const pendentes = linhas.filter((l) => l.status !== "RETORNOU");
  const celulares = linhas.filter((l) => l.celular_devolvido).length;
  const soma = (c) => linhas.reduce((s, l) => s + (Number(l[c]) || 0), 0);
  const porAba = linhas.filter((l) => filtro === "todos" || (filtro === "pendentes" ? l.status !== "RETORNOU" : l.status === "RETORNOU"));
  const visiveis = f.aplicar(porAba);

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
        </div>
        <div className="acoes">
          <div className="alternar">
            <button className={modo === "data" ? "ativo" : ""} onClick={() => setModo("data")}>Por data</button>
            <button className={modo === "emrota" ? "ativo" : ""} onClick={() => setModo("emrota")}>Todos pendentes</button>
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
          <button className="btn link" onClick={() => setModo("emrota")}>Ver todos pendentes</button>
        </div>
      )}

      <section className="kpis">
        <div className="kpi verde"><span>Retornou</span><b>{retornaram.length}</b></div>
        <div className="kpi laranja"><span>Pendente</span><b>{pendentes.length}</b></div>
        <div className="kpi"><span>Celulares devolvidos</span><b>{celulares} / {linhas.length}</b></div>
        <div className="kpi"><span>Cancelados</span><b>{num(soma("cancelados"))}</b></div>
        <div className="kpi"><span>Reentregas</span><b>{num(soma("reentregas"))}</b></div>
        <div className="kpi"><span>Entregas pendentes</span><b>{num(soma("pendentes"))}</b></div>
      </section>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="alternar">
            {[["todos", "Todos"], ["pendentes", "Pendentes"], ["retornados", "Retornados"]].map(([k, r]) => (
              <button key={k} className={filtro === k ? "ativo" : ""} onClick={() => setFiltro(k)}>{r}</button>
            ))}
          </div>
          <div className="linha-acoes"><button className="btn link" title="Volta as colunas para o auto ajuste" onClick={ajustarColunas}>↔ ajustar colunas</button>{f.ativos > 0 && <button className="btn link" onClick={f.limparTudo}>✕ limpar filtros</button>}<span className="sub">{visiveis.length} veículo(s)</span></div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : visiveis.length === 0 ? (
          <div className="vazio">Nenhum veículo {modo === "emrota" ? "pendente" : `no frete de ${fmtData(data)}`}.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="retorno" ref={refTabela}>
              <thead>
                <tr>
                  {modo === "emrota" && <ThFiltro f={f} col="data" linhas={porAba}>Data</ThFiltro>}
                  <ThFiltro f={f} col="placa" linhas={porAba}>Placa</ThFiltro>
                  <ThFiltro f={f} col="trans" linhas={porAba}>Trans</ThFiltro>
                  <ThFiltro f={f} col="ent" linhas={porAba} className="n">Entrega</ThFiltro>
                  <ThFiltro f={f} col="kg" linhas={porAba} className="n">KG</ThFiltro>
                  <ThFiltro f={f} col="motorista" linhas={porAba}>Motorista</ThFiltro>
                  <ThFiltro f={f} col="entregador" linhas={porAba}>Entregador</ThFiltro>
                  <ThFiltro f={f} col="destino" linhas={porAba}>Destino</ThFiltro>
                  <ThFiltro f={f} col="saida" linhas={porAba}>Saída</ThFiltro>
                  <ThFiltro f={f} col="cancel" linhas={porAba} className="n">Cancel.</ThFiltro>
                  <ThFiltro f={f} col="reent" linhas={porAba} className="n">Reentr.</ThFiltro>
                  <ThFiltro f={f} col="pend" linhas={porAba} className="n">Pend.</ThFiltro>
                  <ThFiltro f={f} col="celular" linhas={porAba}>Celular</ThFiltro>
                  <ThFiltro f={f} col="checkout" linhas={porAba}>Checkout</ThFiltro>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const ok = l.status === "RETORNOU";
                  return (
                    <tr key={l.id} className={ok ? "l-verde" : ""}>
                      {modo === "emrota" && <td className="c-data">{fmtData(l.data).slice(0, 5)}</td>}
                      <td className="placa">{l.placa}</td>
                      <td className={corTrans(l.transportadora)}>{l.transportadora}</td>
                      <td className="n">{l.entregas}</td>
                      <td className="n">{num(l.kg)}</td>
                      <td>{l.motorista}</td>
                      <td>{l.entregador}</td>
                      <td>{l.destino}</td>
                      <td>{l.hora_saida ? fmtHora(l.hora_saida) : <span className="t-laranja">a sair</span>}</td>
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
