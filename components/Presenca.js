"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sb } from "../lib/supabase";

// Quem está no site agora e em qual célula cada pessoa está (igual ao Google Planilhas).
// Usa o "Presence" do Supabase Realtime: nada é gravado no banco.

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
  // descrição legível: placa (ou 1º texto da linha) + nome da coluna
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
  const [outros, setOutros] = useState([]); // [{ key, nome, cor, pagina, celula }]
  const canal = useRef(null);
  const meu = useRef({ nome, cor: corDoNome(nome), pagina, celula: null, visivel: true });
  const chave = useRef(null);

  // envia meu estado (com um pequeno atraso para não sobrecarregar)
  const timer = useRef(null);
  function publicar() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      canal.current?.track({ ...meu.current, ts: Date.now() }).catch(() => {});
    }, 120);
  }

  // conecta no canal de presença
  useEffect(() => {
    if (!nome) return;
    chave.current = idCliente();
    meu.current = { ...meu.current, nome, cor: corDoNome(nome) };
    const ch = sb().channel("presenca-site", { config: { presence: { key: chave.current } } });
    ch.on("presence", { event: "sync" }, () => {
      const estado = ch.presenceState();
      const lista = Object.entries(estado)
        .filter(([k]) => k !== chave.current)
        .map(([k, metas]) => ({ key: k, ...metas[metas.length - 1] }))
        .filter((p) => p.nome);
      setOutros(lista);
    });
    ch.subscribe((status) => { if (status === "SUBSCRIBED") ch.track({ ...meu.current, ts: Date.now() }); });
    canal.current = ch;
    return () => { ch.untrack?.(); sb().removeChannel(ch); canal.current = null; };
  }, [nome]);

  // troca de página
  useEffect(() => {
    meu.current = { ...meu.current, pagina, celula: null };
    publicar();
  }, [pagina]);

  // célula onde a pessoa está: onde o mouse passa, clica ou digita (em tempo real)
  useEffect(() => {
    const aoMover = (e) => {
      const c = celulaDe(e.target);
      if (!c) return;
      const a = meu.current.celula;
      if (a && a.t === c.t && a.r === c.r && a.c === c.c) return;
      meu.current = { ...meu.current, celula: c };
      publicar();
    };
    // aba em segundo plano: continua aparecendo para os outros, marcada como "em segundo plano"
    const aoTrocarAba = () => { meu.current = { ...meu.current, visivel: !document.hidden }; publicar(); };
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
        {outros.length === 0 && <span className="presenca-so">só você online</span>}
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
        // esconde se a célula estiver fora da área visível da tabela
        if (area && (r.bottom < area.top + 20 || r.top > area.bottom || r.right < area.left || r.left > area.right)) return;
        if (r.width === 0) return;
        novas.push({ key: p.key, nome: p.nome, cor: p.cor, top: r.top, left: r.left, width: r.width, height: r.height });
      });
      setCaixas((velhas) => (JSON.stringify(velhas) === JSON.stringify(novas) ? velhas : novas));
      quadro = requestAnimationFrame(medir);
    };
    medir();
    return () => cancelAnimationFrame(quadro);
  }, [JSON.stringify(pessoas.map((p) => [p.key, p.celula, p.cor, p.nome]))]);

  return (
    <>
      {caixas.map((c) => (
        <div key={c.key} className="marcador" style={{ top: c.top, left: c.left, width: c.width, height: c.height, borderColor: c.cor }}>
          <span style={{ background: c.cor }}>{c.nome.split(" ")[0]}</span>
        </div>
      ))}
    </>
  );
}
