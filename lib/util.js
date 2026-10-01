export const TZ = "America/Manaus";

// Data de hoje (Manaus) no formato AAAA-MM-DD
export function hojeISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function somarDias(iso, dias) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function fmtData(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function fmtHora(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

export function fmtDataHora(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts));
}

// "07:40" + "2026-08-25" -> timestamp com fuso de Manaus
export function horaParaTimestamp(dataISO, hhmm) {
  if (!hhmm) return null;
  return `${dataISO}T${hhmm.length === 5 ? hhmm : hhmm.slice(0, 5)}:00-04:00`;
}

export function horaInput(ts) {
  return ts ? fmtHora(ts) : "";
}

export function num(v, casas = 0) {
  if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function moeda(v) {
  if (v === null || v === undefined || v === "") return "";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function pct(v) {
  if (v === null || v === undefined || !isFinite(v)) return "";
  return (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "%";
}

export const normPlaca = (p) => String(p || "").trim().toUpperCase().replace(/[\s-]/g, "");

// Zona a partir da descrição da rota do RoadNet
// AM-ZLESTE (TOP) -> LESTE | AM-CSUL -> C-SUL | AM-FLUVIAL RDW -> FLUVIAL | AM-CAPITAL FOOD -> FOOD
export function zonaDaDescricao(desc) {
  const d = String(desc || "").toUpperCase().trim();
  if (!d) return "";
  if (d.includes("AGEND") || d.includes("SENDAS")) return "AGENDADO";
  if (d.includes("REENTREGA")) return "REENTREGA";
  if (d.includes("FLUVIAL")) return "FLUVIAL";
  if (d.includes("FOOD")) return "FOOD";
  const m = d.match(/AM-\s*([ZC])(NORTE|SUL|LESTE|OESTE|CENTRO)/);
  if (m) return m[1] === "C" ? `C-${m[2]}` : m[2];
  const resto = d.replace(/^AM-\s*/, "").replace(/\(.*?\)/g, "").replace(/\d{2}\/\d{2}.*/, "").trim();
  return resto || d;
}

// "<>, RUAN RICHARD DA SILVA" -> "RUAN RICHARD DA SILVA" ; "-" -> ""
export function entregadorDoRoadnet(trab) {
  return String(trab || "")
    .replace(/<>/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "-")
    .join(" / ");
}

// Gera CSV com ; e BOM (abre direto no Excel em português)
export function baixarCSV(nome, cabecalho, linhas) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const txt = [cabecalho, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Cor da célula da transportadora (classe CSS): MAMBA verde, HOK azul claro, CMG cinza claro,
// JB TRANSP branco, RALPH laranja claro, AMORIM azul escuro
export function corTrans(nome) {
  const n = String(nome || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (n.startsWith("MAMBA")) return "ct ct-mamba";
  if (n.startsWith("HOK")) return "ct ct-hok";
  if (n.startsWith("CMG")) return "ct ct-cmg";
  if (n.startsWith("JB")) return "ct ct-jb";
  if (n.startsWith("RALPH")) return "ct ct-ralph";
  if (n.startsWith("AMORIM")) return "ct ct-amorim";
  return "ct";
}
