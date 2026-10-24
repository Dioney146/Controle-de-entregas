"use client";

import { useEffect, useRef } from "react";
import { sb } from "../lib/supabase";
import { avisarMudanca } from "../lib/hooks";

// Vigia de alterações: de 2 em 2 segundos confere se algo mudou no banco (pela "impressão digital"
// das tabelas) e, se mudou, avisa todas as telas abertas para recarregarem.
// Também escuta o tempo real do Supabase para avisar na hora, quando estiver disponível.
export default function Vigia() {
  const ultima = useRef(null);

  useEffect(() => {
    let parado = false;

    async function digital() {
      // 1º: último registro do log (pega qualquer alteração em frete, retorno, veículos, pessoas, programação)
      const log = await sb().from("log_alteracoes").select("id").order("id", { ascending: false }).limit(1);
      if (!log.error) return "L" + (log.data?.[0]?.id ?? 0);
      // sem a tabela de log: usa a última alteração das saídas + a última importação
      const [s, p] = await Promise.all([
        sb().from("saidas").select("updated_at").order("updated_at", { ascending: false }).limit(1),
        sb().from("programacao").select("created_at").order("created_at", { ascending: false }).limit(1),
      ]);
      return "S" + (s.data?.[0]?.updated_at || "") + "|" + (p.data?.[0]?.created_at || "");
    }

    async function conferir() {
      if (parado) return;
      try {
        const d = await digital();
        if (ultima.current !== null && d !== ultima.current) avisarMudanca();
        ultima.current = d;
      } catch {}
    }

    conferir();
    const intervalo = setInterval(conferir, 2000);

    // tempo real (instantâneo) quando o Supabase Realtime estiver ativo
    let t;
    const aviso = () => { clearTimeout(t); t = setTimeout(() => { avisarMudanca(); conferir(); }, 150); };
    const canal = sb().channel("vigia-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "saidas" }, aviso)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "log_alteracoes" }, aviso)
      .subscribe();

    // ao voltar para a aba, recarrega tudo
    const voltar = () => { if (!document.hidden) { avisarMudanca(); conferir(); } };
    document.addEventListener("visibilitychange", voltar);
    window.addEventListener("focus", voltar);

    return () => {
      parado = true;
      clearInterval(intervalo); clearTimeout(t);
      document.removeEventListener("visibilitychange", voltar);
      window.removeEventListener("focus", voltar);
      sb().removeChannel(canal);
    };
  }, []);

  return null;
}
