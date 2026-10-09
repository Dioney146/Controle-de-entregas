"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../lib/supabase";
import { fmtData, somarDias, corTrans } from "../lib/util";

// Veículos que mais usamos no dia a dia e que NÃO estão na programação atual (livres).
// Base: fretes dos últimos 30 dias. HOK aparece primeiro (sai todo dia).
const JANELA = 30;      // dias analisados
const FREQUENTE = 0.3;  // "mais usados" = saíram em pelo menos 30% dos dias com frete

const normPlaca = (p) => String(p || "").trim().toUpperCase().replace(/[\s-]/g, "");

export default function VeiculosDisponiveis({ placasNaProgramacao, dataRef, cadastro }) {
  const [saidas, setSaidas] = useState(null);
  const [todos, setTodos] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!dataRef) return;
    const de = somarDias(dataRef, -JANELA);
    buscarTudo(() => sb().from("saidas").select("placa,transportadora,tipo,data,status").gte("data", de).lt("data", dataRef))
      .then(setSaidas)
      .catch(() => setSaidas([]));
  }, [dataRef]);

  const { grupos, totalDias, qtdLivres } = useMemo(() => {
    if (!saidas) return { grupos: [], totalDias: 0, qtdLivres: 0 };
    const dias = new Set(saidas.map((s) => s.data));
    const porPlaca = new Map();
    for (const s of saidas) {
      const p = normPlaca(s.placa);
      if (!p) continue;
      const v = porPlaca.get(p) || { placa: p, dias: new Set(), ultimo: "", trans: "", tipo: "", emRota: false };
      v.dias.add(s.data);
      if (s.data >= v.ultimo) { v.ultimo = s.data; v.trans = s.transportadora || v.trans; v.tipo = s.tipo || v.tipo; v.emRota = s.status === "EM_ROTA"; }
      porPlaca.set(p, v);
    }
    const lista = [...porPlaca.values()]
      .map((v) => {
        const cad = cadastro[v.placa];
        return {
          ...v,
          trans: (cad?.transportadora || v.trans || "SEM TRANSP.").toUpperCase(),
          tipo: cad?.tipo || v.tipo || "",
          usados: v.dias.size,
          freq: dias.size ? v.dias.size / dias.size : 0,
        };
      })
      .filter((v) => !placasNaProgramacao.has(v.placa))
      .filter((v) => todos || v.freq >= FREQUENTE)
      .sort((a, b) => b.usados - a.usados || a.placa.localeCompare(b.placa));
    const porTrans = new Map();
    for (const v of lista) porTrans.set(v.trans, [...(porTrans.get(v.trans) || []), v]);
    const ordem = (t) => (t.startsWith("HOK") ? "0" : "1") + t;
    const grupos = [...porTrans.entries()].sort((a, b) => ordem(a[0]).localeCompare(ordem(b[0])));
    return { grupos, totalDias: dias.size, qtdLivres: lista.length };
  }, [saidas, placasNaProgramacao, cadastro, todos]);

  function copiar() {
    const txt = grupos.flatMap(([, vs]) => vs.map((v) => v.placa)).join("\n");
    navigator.clipboard?.writeText(txt).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); });
  }

  return (
    <section className="cartao disponiveis">
      <div className="disp-cab">
        <div>
          <b>Veículos disponíveis</b>
          <span className="sub"> · os mais usados nos últimos {JANELA} dias ({totalDias} dias com frete) que <b>não</b> estão nesta programação</span>
        </div>
        <div className="linha-acoes">
          <label className="check"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> mostrar também os pouco usados</label>
          {qtdLivres > 0 && <button className="btn link" onClick={copiar}>{copiado ? "✓ copiado" : "⧉ copiar placas"}</button>}
        </div>
      </div>
      {!saidas ? (
        <div className="carregando">Carregando…</div>
      ) : qtdLivres === 0 ? (
        <div className="vazio">Nenhum veículo frequente livre — todos os mais usados já estão na programação. 👍</div>
      ) : (
        <div className="disp-grupos">
          {grupos.map(([trans, vs]) => (
            <div key={trans} className="disp-grupo">
              <div className={`disp-trans ${corTrans(trans)}`}>{trans} <small>{vs.length} livre(s)</small></div>
              <div className="disp-lista">
                {vs.map((v) => (
                  <div key={v.placa} className={`disp-veic ${v.emRota ? "em-rota" : ""}`}
                    title={`Saiu em ${v.usados} de ${totalDias} dias · último frete ${fmtData(v.ultimo)}${v.emRota ? " · ainda sem checkout no Retorno" : ""}`}>
                    <span className="disp-placa">{v.placa}</span>
                    <span className="disp-tipo">{v.tipo || "—"}</span>
                    <span className="disp-uso">
                      <i style={{ width: `${Math.round(v.freq * 100)}%` }} />
                    </span>
                    <small>{v.usados}/{totalDias} dias · últ. {fmtData(v.ultimo).slice(0, 5)}{v.emRota ? " · em rota" : ""}</small>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
