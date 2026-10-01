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
  "/": "Programação", "/frete": "Frete / Saídas", "/retorno": "Retorno",
  "/historico": "Histórico", "/veiculos": "Veículos", "/pessoas": "Motoristas / Entregadores",
};

function idCliente() {
  try {
    let id = sessionStorage.getItem("idPresenca");
    if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem("idPresenca", id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 10); }
}

// descobre a célula (tabela / linha / coluna) a partir de um elemento clicado
function celulaDe(el) {
  const td = el?.closest?.("td");
  const tr = td?.closest("tr[data-id]");
  const tabela = td?.closest("table[data-tabela]");
  if (!td || !tr || !tabela) return null;
  return { t: tabela.dataset.tabela, r: tr.dataset.id, c: td.cellIndex };
}

function acharCelula(cel) {
  if (!cel) return null;
  const tr = document.querySelector(`table[data-tabela="${cel.t}"] tr[data-id="${CSS.escape(String(cel.r))}"]`);
  return tr?.cells?.[cel.c] || null;
}

export default function Presenca({ nome, pagina }) {
  const [outros, setOutros] = useState([]); // [{ key, nome, cor, pagina, celula }]
  const canal = useRef(null);
  const meu = useRef({ nome, cor: corDoNome(nome), pagina, celula: null });
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

  // célula selecionada (clique ou foco)
  useEffect(() => {
    const aoSelecionar = (e) => {
      const c = celulaDe(e.target);
      if (!c) return;
      const a = meu.current.celula;
      if (a && a.t === c.t && a.r === c.r && a.c === c.c) return;
      meu.current = { ...meu.current, celula: c };
      publicar();
    };
    document.addEventListener("mousedown", aoSelecionar, true);
    document.addEventListener("focusin", aoSelecionar, true);
    return () => {
      document.removeEventListener("mousedown", aoSelecionar, true);
      document.removeEventListener("focusin", aoSelecionar, true);
    };
  }, []);

  const naMesmaPagina = outros.filter((p) => p.pagina === pagina && p.celula);

  return (
    <>
      <div className="presenca" title="Quem está no site agora">
        {outros.length === 0 && <span className="presenca-so">só você</span>}
        {outros.map((p) => (
          <span
            key={p.key}
            className={`avatar ${p.pagina === pagina ? "" : "outra-pagina"}`}
            style={{ background: p.cor }}
            title={`${p.nome} — ${NOME_PAGINA[p.pagina] || p.pagina}`}
          >
            {iniciais(p.nome)}
          </span>
        ))}
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
