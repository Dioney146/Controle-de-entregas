"use client";

import { useEffect, useRef, useState } from "react";
import { BAIRROS_MANAUS } from "../lib/bairros";

// Bairro: pesquisa na lista oficial de Manaus (só aceita bairro da lista) — igual ao site de Reentregas
export default function ComboBairro({ valor, aoMudar, id, aoEscolher, placeholder = "— Selecione ou digite o bairro —" }) {
  const [busca, setBusca] = useState(valor);
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState(0);
  const caixa = useRef(null);

  useEffect(() => { setBusca(valor); }, [valor]);
  useEffect(() => {
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) { setAberto(false); setBusca(valor); } };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [valor]);

  const tira = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const lista = BAIRROS_MANAUS.filter((b) => !busca || busca === valor || tira(b).includes(tira(busca)));

  function escolher(b) { aoMudar(b); setBusca(b); setAberto(false); aoEscolher?.(b); }

  return (
    <div className="combo" ref={caixa}>
      <input
        id={id} className={`campo ${valor ? "combo-ok" : ""}`} placeholder={placeholder} value={busca} autoComplete="off"
        onFocus={() => { setAberto(true); setSel(0); }}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); setSel(0); if (valor) aoMudar(""); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, lista.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Enter" && aberto && lista[sel]) { e.preventDefault(); escolher(lista[sel]); }
          if (e.key === "Escape") setAberto(false);
        }}
      />
      {aberto && (
        <div className="combo-lista">
          {lista.length ? lista.map((b, i) => (
            <div key={b} className={`combo-item ${i === sel ? "sel" : ""}`} onMouseDown={(e) => { e.preventDefault(); escolher(b); }}>{b}</div>
          )) : <div className="combo-item sub">Nenhum bairro encontrado</div>}
        </div>
      )}
    </div>
  );
}
