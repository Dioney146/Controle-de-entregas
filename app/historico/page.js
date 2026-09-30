"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import { useColunas } from "../../lib/colunas";
import { hojeISO, somarDias, fmtData, fmtHora, fmtDataHora, num, moeda, baixarCSV } from "../../lib/util";

export default function Historico() {
  const [de, setDe] = useState(somarDias(hojeISO(), -30));
  const [ate, setAte] = useState(hojeISO());
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [trans, setTrans] = useState("");
  const [zona, setZona] = useState("");
  const [limite, setLimite] = useState(300);

  async function carregar() {
    setCarregando(true);
    try {
      const d = await buscarTudo(() =>
        sb().from("saidas").select("*").neq("status", "PROGRAMADO").gte("data", de).lte("data", ate)
          .order("data", { ascending: false }).order("ordem").order("id")
      );
      setLinhas(d);
    } catch (e) { alert(e.message); }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, [de, ate]);

  const transportadoras = useMemo(() => [...new Set(linhas.map((l) => l.transportadora).filter(Boolean))].sort(), [linhas]);
  const zonas = useMemo(() => [...new Set(linhas.map((l) => l.zona).filter(Boolean))].sort(), [linhas]);

  const filtradas = useMemo(() => {
    const b = busca.trim().toUpperCase();
    return linhas.filter((l) =>
      (!trans || l.transportadora === trans) &&
      (!zona || l.zona === zona) &&
      (!b || [l.placa, l.motorista, l.entregador, l.destino].some((x) => (x || "").toUpperCase().includes(b)))
    );
  }, [linhas, busca, trans, zona]);

  const [refTabela, ajustarColunas] = useColunas("historico", `${carregando}-${Math.min(filtradas.length, limite)}`);
  const soma = (c) => filtradas.reduce((s, l) => s + (Number(l[c]) || 0), 0);
  const dias = new Set(filtradas.map((l) => l.data)).size;

  function exportar() {
    baixarCSV(`historico_${de}_a_${ate}.csv`,
      ["DATA", "ZONA", "PLACA", "TRANS", "TIPO", "ENT.", "KG", "MOTORISTA", "ENTREGADORES", "INFOR", "VALOR", "SAIDA", "STATUS", "CANCELADOS", "REENTREGAS", "PENDENTES", "CELULAR DEVOLVIDO", "CHECKOUT", "CHECKOUT POR", "OBS"],
      filtradas.map((l) => [
        fmtData(l.data), l.zona, l.placa, l.transportadora, l.tipo, l.entregas ?? "",
        l.kg !== null ? String(l.kg).replace(".", ",") : "", l.motorista, l.entregador, l.destino,
        l.valor !== null ? String(l.valor).replace(".", ",") : "", fmtHora(l.hora_saida), l.status,
        l.cancelados, l.reentregas, l.pendentes, l.celular_devolvido ? "SIM" : "NÃO",
        fmtDataHora(l.checkout_em), l.checkout_por || "", l.obs,
      ])
    );
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Histórico de saídas</h1>
          <p className="sub">Tudo que saiu (saída confirmada no frete), com os dados do retorno.</p>
        </div>
        <div className="acoes">
          <label className="campo-data">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="campo-data">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          <button className="btn" onClick={exportar} disabled={!filtradas.length}>Exportar Excel (CSV)</button>
        </div>
      </div>

      <section className="kpis">
        <div className="kpi"><span>Saídas</span><b>{num(filtradas.length)}</b><small>{dias} dia(s)</small></div>
        <div className="kpi"><span>Entregas</span><b>{num(soma("entregas"))}</b></div>
        <div className="kpi"><span>Peso</span><b>{num(soma("kg"))} kg</b></div>
        <div className="kpi"><span>Valor</span><b>{moeda(soma("valor"))}</b></div>
        <div className="kpi"><span>Cancelados · Reentregas</span><b>{num(soma("cancelados"))} · {num(soma("reentregas"))}</b></div>
      </section>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="linha-acoes">
            <input className="campo" placeholder="Buscar placa, motorista, entregador, destino…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 280 }} />
            <select className="campo" value={trans} onChange={(e) => setTrans(e.target.value)}>
              <option value="">Todas transportadoras</option>
              {transportadoras.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select className="campo" value={zona} onChange={(e) => setZona(e.target.value)}>
              <option value="">Todas zonas</option>
              {zonas.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="linha-acoes"><button className="btn link" title="Volta as colunas para o auto ajuste" onClick={ajustarColunas}>↔ ajustar colunas</button><span className="sub">{filtradas.length} registro(s)</span></div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : filtradas.length === 0 ? (
          <div className="vazio">Nenhuma saída no período.</div>
        ) : (
          <div className="tabela-rolagem">
            <table ref={refTabela}>
              <thead>
                <tr>
                  <th>Data</th><th>Zona</th><th>Placa</th><th>Trans</th><th className="n">Ent.</th><th className="n">KG</th><th>Motorista</th>
                  <th>Entregadores</th><th>Infor</th><th className="n">Valor</th><th>Saída</th><th className="n">Canc.</th><th className="n">Reent.</th><th className="n">Pend.</th><th>Cel.</th><th>Retorno</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.slice(0, limite).map((l) => (
                  <tr key={l.id}>
                    <td>{fmtData(l.data)}</td><td>{l.zona}</td><td className="placa">{l.placa}</td><td>{l.transportadora}</td>
                    <td className="n">{l.entregas}</td><td className="n">{num(l.kg)}</td><td>{l.motorista}</td><td>{l.entregador}</td>
                    <td>{l.destino}</td><td className="n">{moeda(l.valor)}</td><td>{fmtHora(l.hora_saida) || l.obs}</td>
                    <td className="n">{l.cancelados || ""}</td><td className="n">{l.reentregas || ""}</td><td className="n">{l.pendentes || ""}</td>
                    <td className="c">{l.celular_devolvido ? "✓" : ""}</td>
                    <td>{l.status === "EM_ROTA" ? <span className="status s-EM_ROTA">Em rota</span> : fmtDataHora(l.checkout_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtradas.length > limite && (
              <div className="vazio"><button className="btn" onClick={() => setLimite(limite + 500)}>Mostrar mais ({filtradas.length - limite} restantes)</button></div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
