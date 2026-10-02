"use client";

import { useEffect, useState } from "react";

// Campo que salva sozinho quando perde o foco (ou Enter). Se aoSalvar devolver false, volta ao valor anterior.
export default function CampoEditavel({ valor, aoSalvar, tipo = "text", lista, className = "", placeholder = "", min, largura, autoFocus = false }) {
  const [v, setV] = useState(valor ?? "");
  const [estado, setEstado] = useState(""); // "", "salvando", "ok", "erro"

  useEffect(() => { setV(valor ?? ""); }, [valor]);

  async function salvar() {
    const original = valor ?? "";
    if (String(v) === String(original)) return;
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
      type={tipo}
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
