"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sb } from "../lib/supabase";

// Quem está no site agora e em qual célula cada pessoa está (igual ao Google Planilhas).
// Cada aba grava sua posição na tabela "presenca" (a cada mudança e a cada poucos segundos)
// e lê a de todo mundo: pelo tempo real do Supabase (na hora) + conferência a cada 2 segundos.

const CORES = ["#e53935", "#8e24aa", "#3949ab", "#00897b", "#f4511e", "#6d4c41", "#d81b60", "#1e88e5", "#43a047", "#fb8c00"];
export function corDoNome(nome) {
  let h = 0;
  for (const ch of String(nome || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}
export const iniciais = (nome) =>
  String(nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

const NOME_PAGINA = {
  "/": "Programação", "/frete": "Frete", "/retorno": "Retorno",
  "/historico": "Histórico", "/veiculos": "Veículos", "/pessoas": "Motoristas", "/log": "Log",
};

const ONLINE_ATIVO = 25 * 1000;       // aba aberta: some se ficar 25s sem sinal
const ONLINE_FUNDO = 3 * 60 * 1000;   // aba em segundo plano: navegador desacelera, então tolera 3 min
const BATIMENTO = 8 * 1000;

function idCliente() {
  try {
    let id = sessionStorage.getItem("idPresenca");
    if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem("idPresenca", id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 10); }
}

// descobre a célula (tabela / linha / coluna) a partir de um elemento
function celulaDe(el) {
  const td = el?.closest?.("td");
  const tr = td?.closest("tr[data-id]");
  const tabela = td?.closest("table[data-tabela]");
  if (!td || !tr || !tabela) return null;
  const th = tabela.querySelector("thead tr")?.cells?.[td.cellIndex];
  const coluna = (th?.querySelector(".th-rotulo")?.textContent || th?.textContent || "").trim();
  const ref = (tr.querySelector("td.placa")?.textContent || tr.dataset.ref || "").trim();
  return { t: tabela.dataset.tabela, r: tr.dataset.id, c: td.cellIndex, d: [ref, coluna].filter(Boolean).join(" · ") };
}

function acharCelula(cel) {
  if (!cel) return null;
  const tr = document.querySelector(`table[data-tabela="${cel.t}"] tr[data-id="${CSS.escape(String(cel.r))}"]`);
  return tr?.cells?.[cel.c] || null;
}

export default function Presenca({ nome, pagina }) {
  const [outros, setOutros] = useState([]);
  const [erro, setErro] = useState(false);
  const chave = useRef(null);
  const meu = useRef({ nome, cor: corDoNome(nome), pagina, celula: null, visivel: true });

  // ---------- gravar minha posição ----------
  const timer = useRef(null);
  const gravando = useRef(false);
  async function gravarAgora() {
    if (!chave.current) return;
    gravando.current = true;
    const { error } = await sb().from("presenca").upsert({
      chave: chave.current, nome: meu.current.nome, cor: meu.current.cor, pagina: meu.current.pagina,
      celula: meu.current.celula, visivel: meu.current.visivel, visto_em: new Date().toISOString(),
    });
    gravando.current = false;
    setErro(Boolean(error));
  }
  function publicar() {
    clearTimeout(timer.current);
    timer.current = setTimeout(gravarAgora, 250);
  }

  // ---------- ler a posição de todo mundo ----------
  async function lerTodos() {
    const desde = new Date(Date.now() - ONLINE_FUNDO).toISOString();
    const { data, error } = await sb().from("presenca").select("*").gte("visto_em", desde);
    if (error) { setErro(true); return; }
    const agora = Date.now();
    const lista = (data || [])
      .filter((p) => p.chave !== chave.current && p.nome)
      .filter((p) => agora - new Date(p.visto_em).getTime() < (p.visivel ? ONLINE_ATIVO : ONLINE_FUNDO))
      .map((p) => ({ key: p.chave, ...p }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    setOutros((velha) => (JSON.stringify(velha) === JSON.stringify(lista) ? velha : lista));
  }

  useEffect(() => {
    if (!nome) return;
    chave.current = idCliente();
    meu.current = { ...meu.current, nome, cor: corDoNome(nome), visivel: !document.hidden };
    gravarAgora();
    lerTodos();

    const batida = setInterval(gravarAgora, BATIMENTO);
    const leitura = setInterval(lerTodos, 2000);

    // tempo real: quando alguém mexe, atualiza na hora (se o Supabase Realtime estiver ativo)
    let t;
    const canal = sb().channel("presenca-db-" + chave.current)
      .on("postgres_changes", { event: "*", schema: "public", table: "presenca" }, () => { clearTimeout(t); t = setTimeout(lerTodos, 80); })
      .subscribe();

    // ao fechar a aba, sai da lista na hora
    const sair = () => {
      try {
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/presenca?chave=eq.${chave.current}`, {
          method: "DELETE", keepalive: true,
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
        });
      } catch {}
    };
    window.addEventListener("pagehide", sair);

    return () => {
      clearInterval(batida); clearInterval(leitura); clearTimeout(t);
      window.removeEventListener("pagehide", sair);
      sb().removeChannel(canal);
    };
  }, [nome]);

  // troca de página
  useEffect(() => {
    meu.current = { ...meu.current, pagina, celula: null };
    publicar();
  }, [pagina]);

  // célula onde a pessoa está: onde o mouse passa, clica ou digita
  useEffect(() => {
    const aoMover = (e) => {
      const c = celulaDe(e.target);
      if (!c) return;
      const a = meu.current.celula;
      if (a && a.t === c.t && a.r === c.r && a.c === c.c) return;
      meu.current = { ...meu.current, celula: c };
      publicar();
    };
    const aoTrocarAba = () => {
      meu.current = { ...meu.current, visivel: !document.hidden };
      gravarAgora();
      if (!document.hidden) lerTodos();
    };
    document.addEventListener("mouseover", aoMover, true);
    document.addEventListener("mousedown", aoMover, true);
    document.addEventListener("focusin", aoMover, true);
    document.addEventListener("visibilitychange", aoTrocarAba);
    return () => {
      document.removeEventListener("mouseover", aoMover, true);
      document.removeEventListener("mousedown", aoMover, true);
      document.removeEventListener("focusin", aoMover, true);
      document.removeEventListener("visibilitychange", aoTrocarAba);
    };
  }, []);

  const naMesmaPagina = outros.filter((p) => p.pagina === pagina && p.celula);

  return (
    <>
      <div className="presenca" title="Quem está no site agora">
        {erro && <span className="presenca-so" title="Rode o arquivo 07_presenca.sql no Supabase">⚠ presença indisponível</span>}
        {!erro && outros.length === 0 && <span className="presenca-so">só você online</span>}
        {outros.map((p) => {
          const onde = [NOME_PAGINA[p.pagina] || p.pagina, p.celula?.d].filter(Boolean).join(" › ");
          return (
            <span
              key={p.key}
              className={`pessoa-online ${p.visivel === false ? "fundo" : ""}`}
              style={{ borderColor: p.cor }}
              title={`${p.nome} — ${onde}${p.visivel === false ? " (em segundo plano)" : ""}`}
            >
              <span className="avatar" style={{ background: p.cor }}>{iniciais(p.nome)}</span>
              <b>{p.nome.split(" ")[0]}</b>
              <small>{onde}{p.visivel === false ? " · 💤" : ""}</small>
            </span>
          );
        })}
      </div>
      {typeof document !== "undefined" && createPortal(<Marcadores pessoas={naMesmaPagina} />, document.body)}
    </>
  );
}

// Desenha a moldura colorida com o nome em cima da célula de cada pessoa
function Marcadores({ pessoas }) {
  const [caixas, setCaixas] = useState([]);

  useEffect(() => {
    if (!pessoas.length) { setCaixas([]); return; }
    let quadro;
    const medir = () => {
      const novas = [];
      pessoas.forEach((p) => {
        const td = acharCelula(p.celula);
        if (!td) return;
        const r = td.getBoundingClientRect();
        const area = td.closest(".tabela-rolagem")?.getBoundingClientRect();
        if (area && (r.bottom < area.top + 20 || r.top > area.bottom || r.right < area.left || r.left > area.right)) return;
        if (r.width === 0) return;
        novas.push({ key: p.key, nome: p.nome, cor: p.cor, fundo: p.visivel === false, top: r.top, left: r.left, width: r.width, height: r.height });
      });
      setCaixas((velhas) => (JSON.stringify(velhas) === JSON.stringify(novas) ? velhas : novas));
      quadro = requestAnimationFrame(medir);
    };
    medir();
    return () => cancelAnimationFrame(quadro);
  }, [JSON.stringify(pessoas.map((p) => [p.key, p.celula, p.cor, p.nome, p.visivel]))]);

  return (
    <>
      {caixas.map((c) => (
        <div key={c.key} className={`marcador ${c.fundo ? "fundo" : ""}`} style={{ top: c.top, left: c.left, width: c.width, height: c.height, borderColor: c.cor }}>
          <span style={{ background: c.cor }}>{c.nome.split(" ")[0]}{c.fundo ? " 💤" : ""}</span>
        </div>
      ))}
    </>
  );
}
