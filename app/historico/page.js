"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import { useColunas } from "../../lib/colunas";
import { useTempoReal } from "../../lib/hooks";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { fmtData, fmtHora, fmtDataHora, num, moeda, baixarCSV, corTrans } from "../../lib/util";

// colunas filtráveis / classificáveis (igual ao Excel)
const COLUNAS = {
  data: { valor: (l) => l.data, rotulo: (v) => fmtData(v) },
  zona: { valor: (l) => l.zona },
  placa: { valor: (l) => l.placa },
  trans: { valor: (l) => l.transportadora },
  ent: { valor: (l) => l.entregas, numero: true },
  kg: { valor: (l) => l.kg, numero: true },
  motorista: { valor: (l) => l.motorista },
  entregador: { valor: (l) => l.entregador },
  infor: { valor: (l) => l.destino },
  valor: { valor: (l) => l.valor, numero: true },
  saida: { valor: (l) => fmtHora(l.hora_saida) || l.obs },
  canc: { valor: (l) => l.cancelados || 0, numero: true },
  reent: { valor: (l) => l.reentregas || 0, numero: true },
  pend: { valor: (l) => l.pendentes || 0, numero: true },
  cel: { valor: (l) => (l.celular_devolvido ? "DEVOLVIDO" : "NÃO") },
  retorno: { valor: (l) => (l.checkout_em ? "OK" : l.status === "RETORNOU" ? "OK" : "PENDENTE") },
};

export default function Historico() {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [de, setDe] = useState("");   // opcional
  const [ate, setAte] = useState(""); // opcional
  const [limite, setLimite] = useState(400);
  const f = useFiltros(COLUNAS);

  // Mostra TUDO o que foi enviado para o histórico (sem precisar escolher datas)
  async function carregar() {
    try {
      const d = await buscarTudo(() =>
        sb().from("saidas").select("*").eq("arquivado", true)
          .order("data", { ascending: false }).order("ordem").order("id")
      );
      setLinhas(d);
    } catch (e) { alert(e.message); }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useTempoReal(carregar, []);

  const base = useMemo(() => {
    const b = busca.trim().toUpperCase();
    return linhas.filter((l) =>
      (!de || l.data >= de) && (!ate || l.data <= ate) &&
      (!b || [l.placa, l.motorista, l.entregador, l.destino, l.transportadora, l.zona].some((x) => (x || "").toUpperCase().includes(b)))
    );
  }, [linhas, busca, de, ate]);
  const filtradas = f.aplicar(base);

  const [refTabela, ajustarColunas] = useColunas("historico2", `${carregando}-${Math.min(filtradas.length, limite)}`);
  const soma = (c) => filtradas.reduce((s, l) => s + (Number(l[c]) || 0), 0);
  const dias = new Set(filtradas.map((l) => l.data)).size;

  function exportar() {
    baixarCSV(`historico${de ? "_" + de : ""}${ate ? "_a_" + ate : ""}.csv`,
      ["DATA", "ZONA", "PLACA", "TRANS", "TIPO", "ENT.", "KG", "MOTORISTA", "ENTREGADORES", "INFOR", "VALOR", "SAIDA", "STATUS", "CANCELADOS", "REENTREGAS", "PENDENTES", "CELULAR DEVOLVIDO", "CHECKOUT", "CHECKOUT POR", "ENVIADO AO HISTORICO", "OBS"],
      filtradas.map((l) => [
        fmtData(l.data), l.zona, l.placa, l.transportadora, l.tipo, l.entregas ?? "",
        l.kg !== null ? String(l.kg).replace(".", ",") : "", l.motorista, l.entregador, l.destino,
        l.valor !== null ? String(l.valor).replace(".", ",") : "", fmtHora(l.hora_saida), l.status,
        l.cancelados, l.reentregas, l.pendentes, l.celular_devolvido ? "SIM" : "NÃO",
        fmtDataHora(l.checkout_em), l.checkout_por || "", fmtDataHora(l.arquivado_em), l.obs,
      ])
    );
  }

  const limparTudo = () => { f.limparTudo(); setBusca(""); setDe(""); setAte(""); };
  const temFiltro = f.ativos > 0 || busca || de || ate;

  return (
    <>
      <div className="cabecalho-pagina">
        <div className="linha-acoes">
          <input className="campo" placeholder="Pesquisar placa, motorista, entregador, destino…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 320 }} />
          <label className="campo-data">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="campo-data">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          {temFiltro && <button className="btn link" onClick={limparTudo}>✕ limpar filtros</button>}
        </div>
        <div className="acoes">
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
          <span className="sub">{filtradas.length} de {linhas.length} registro(s) no histórico</span>
          <button className="btn link" title="Volta as colunas para o auto ajuste" onClick={ajustarColunas}>↔ ajustar colunas</button>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : linhas.length === 0 ? (
          <div className="vazio">Nada no histórico ainda. No Frete/Saídas, clique em <b>✓ Enviar para o histórico</b>.</div>
        ) : (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela="historico">
              <thead>
                <tr>
                  <ThFiltro f={f} col="data" linhas={base}>Data</ThFiltro>
                  <ThFiltro f={f} col="zona" linhas={base}>Zona</ThFiltro>
                  <ThFiltro f={f} col="placa" linhas={base}>Placa</ThFiltro>
                  <ThFiltro f={f} col="trans" linhas={base}>Trans</ThFiltro>
                  <ThFiltro f={f} col="ent" linhas={base} className="n">Ent.</ThFiltro>
                  <ThFiltro f={f} col="kg" linhas={base} className="n">KG</ThFiltro>
                  <ThFiltro f={f} col="motorista" linhas={base}>Motorista</ThFiltro>
                  <ThFiltro f={f} col="entregador" linhas={base}>Entregadores</ThFiltro>
                  <ThFiltro f={f} col="infor" linhas={base}>Infor</ThFiltro>
                  <ThFiltro f={f} col="valor" linhas={base} className="n">Valor</ThFiltro>
                  <ThFiltro f={f} col="saida" linhas={base}>Saída</ThFiltro>
                  <ThFiltro f={f} col="canc" linhas={base} className="n">Canc.</ThFiltro>
                  <ThFiltro f={f} col="reent" linhas={base} className="n">Reent.</ThFiltro>
                  <ThFiltro f={f} col="pend" linhas={base} className="n">Pend.</ThFiltro>
                  <ThFiltro f={f} col="cel" linhas={base}>Cel.</ThFiltro>
                  <ThFiltro f={f} col="retorno" linhas={base}>Retorno</ThFiltro>
                </tr>
              </thead>
              <tbody>
                {filtradas.slice(0, limite).map((l) => (
                  <tr key={l.id} data-id={l.id}>
                    <td className="c-data">{fmtData(l.data)}</td><td>{l.zona}</td><td className="placa">{l.placa}</td><td className={corTrans(l.transportadora)}>{l.transportadora}</td>
                    <td className="n">{l.entregas}</td><td className="n">{num(l.kg)}</td><td>{l.motorista}</td><td>{l.entregador}</td>
                    <td>{l.destino}</td><td className="n">{moeda(l.valor)}</td><td>{fmtHora(l.hora_saida) || l.obs}</td>
                    <td className="n">{l.cancelados || ""}</td><td className="n">{l.reentregas || ""}</td><td className="n">{l.pendentes || ""}</td>
                    <td className="c">{l.celular_devolvido ? "✓" : ""}</td>
                    <td>{l.checkout_em ? fmtDataHora(l.checkout_em) : l.status === "RETORNOU" ? "OK" : <span className="status s-EM_ROTA">Pendente</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtradas.length > limite && (
              <div className="vazio"><button className="btn" onClick={() => setLimite(limite + 1000)}>Mostrar mais ({filtradas.length - limite} restantes)</button></div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
