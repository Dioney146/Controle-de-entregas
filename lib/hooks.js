"use client";

import { useEffect, useState } from "react";
import { sb } from "./supabase";
import { hojeISO, somarDias } from "./util";

// "Data de trabalho" compartilhada entre as telas (fica só neste navegador/aba)
export function lerDataTrabalho() {
  try { return sessionStorage.getItem("dataTrabalho"); } catch { return null; }
}
export function guardarDataTrabalho(d) {
  try { if (d) sessionStorage.setItem("dataTrabalho", d); } catch {}
}

// Data vinda da URL (?data=AAAA-MM-DD), ou a última usada, ou hoje
export function useDataDaUrl() {
  const [data, setDataState] = useState(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const d = p.get("data") || lerDataTrabalho() || hojeISO();
    guardarDataTrabalho(d);
    setDataState(d);
  }, []);
  function setData(d) {
    setDataState(d);
    guardarDataTrabalho(d);
    const url = new URL(window.location.href);
    url.searchParams.set("data", d);
    window.history.replaceState(null, "", url.toString());
  }
  return [data, setData];
}

// Nomes já usados (para sugerir enquanto digita)
export function useNomes() {
  const [nomes, setNomes] = useState({ motoristas: [], entregadores: [] });
  useEffect(() => {
    (async () => {
      const [s, v] = await Promise.all([
        sb().from("saidas").select("motorista,entregador").gte("data", somarDias(hojeISO(), -180)).limit(5000),
        sb().from("veiculos").select("motorista,entregador"),
      ]);
      const todos = [...(s.data || []), ...(v.data || [])];
      const uniq = (campo) => [...new Set(todos.map((x) => (x[campo] || "").trim().toUpperCase()).filter(Boolean))].sort();
      setNomes({ motoristas: uniq("motorista"), entregadores: uniq("entregador") });
    })();
  }, []);
  return nomes;
}

// Atualiza a lista quando alguém muda a tabela "saidas" (tempo real)
export function useTempoReal(aoMudar, deps = []) {
  useEffect(() => {
    let t;
    const canal = sb()
      .channel("saidas-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "saidas" }, () => {
        clearTimeout(t);
        t = setTimeout(aoMudar, 400);
      })
      .subscribe();
    const intervalo = setInterval(aoMudar, 60000); // garantia: recarrega a cada 1 min
    return () => { clearTimeout(t); clearInterval(intervalo); sb().removeChannel(canal); };
  }, deps);
}
