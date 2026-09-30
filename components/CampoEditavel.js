"use client";

import { useEffect, useState } from "react";

// Campo que salva sozinho quando perde o foco (ou Enter)
export default function CampoEditavel({ valor, aoSalvar, tipo = "text", lista, className = "", placeholder = "", min, largura }) {
  const [v, setV] = useState(valor ?? "");
  const [estado, setEstado] = useState(""); // "", "salvando", "ok", "erro"

  useEffect(() => { setV(valor ?? ""); }, [valor]);

  async function salvar() {
    const original = valor ?? "";
    if (String(v) === String(original)) return;
    setEstado("salvando");
    try {
      await aoSalvar(tipo === "number" ? (v === "" ? 0 : Number(v)) : typeof v === "string" ? v.toUpperCase().trim() : v);
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
      style={largura ? { width: largura } : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
    </>
  );
}
