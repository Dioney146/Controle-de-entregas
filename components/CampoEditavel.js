"use client";

import { useEffect, useState } from "react";
import { lerNumeroBR } from "../lib/util";

// tipo="decimal": mostra no padrão brasileiro (1.234,56) e aceita vírgula
const fmtDec = (v, casas) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));

// Campo que salva sozinho quando perde o foco (ou Enter). Se aoSalvar devolver false, volta ao valor anterior.
export default function CampoEditavel({ valor, aoSalvar, tipo = "text", lista, className = "", placeholder = "", min, largura, autoFocus = false, casas = 2 }) {
  const dec = tipo === "decimal";
  const mostrar = (x) => (dec ? fmtDec(x, casas) : x ?? "");
  const [v, setV] = useState(mostrar(valor));
  const [estado, setEstado] = useState(""); // "", "salvando", "ok", "erro"

  useEffect(() => { setV(mostrar(valor)); }, [valor]);

  async function salvar() {
    const original = mostrar(valor);
    if (String(v) === String(original)) return;
    if (dec) {
      const n = lerNumeroBR(v);
      if (v !== "" && n === null) { alert("Número inválido."); setV(original); return; }
      setEstado("salvando");
      try {
        const r = await aoSalvar(n);
        if (r === false) { setV(original); setEstado(""); return; }
        setV(mostrar(n)); setEstado("ok"); setTimeout(() => setEstado(""), 900);
      } catch (e) { setEstado("erro"); alert("Não foi possível salvar: " + (e?.message || e)); }
      return;
    }
    setEstado("salvando");
    try {
      const r = await aoSalvar(tipo === "number" ? (v === "" ? 0 : Number(v)) : typeof v === "string" ? v.toUpperCase().trim() : v);
      if (r === false) { setV(original); setEstado(""); return; } // cancelado: volta ao valor anterior
      setEstado("ok");
      setTimeout(() => setEstado(""), 900);
    } catch (e) {
      setEstado("erro");
      alert("Não foi possível salvar: " + (e?.message || e));
    }
  }

  return (
    <>
    <span className="so-imprimir">{v}</span>
    <input
      className={`campo-ed nao-imprimir ${estado} ${className}`}
      type={dec ? "text" : tipo}
      inputMode={dec ? "decimal" : undefined}
      value={v}
      min={min}
      list={lista}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
    </>
  );
}
