"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sb } from "../lib/supabase";

// Quem está no site agora, em qual célula e onde está o mouse (igual ao Google Planilhas).
// Duas vias, ao mesmo tempo:
//  1) AO VIVO: o mouse é transmitido pelo canal "broadcast" do Supabase (~15 vezes por segundo);
//  2) SEGURANÇA: a posição também é gravada na tabela "presenca" e conferida a cada 2 segundos,
//     então mesmo se o "ao vivo" cair, todo mundo continua aparecendo.

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
const BATIMENTO = 8 * 1000;           // grava "estou aqui" no banco
const INTERVALO_MOUSE = 66;           // ms entre envios do mouse (~15 por segundo)

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
  return { td, cel: { t: tabela.dataset.tabela, r: tr.dataset.id, c: td.cellIndex, d: [ref, coluna].filter(Boolean).join(" · ") } };
}

function acharCelula(cel) {
  if (!cel) return null;
  const tr = document.querySelector(`table[data-tabela="${cel.t}"] tr[data-id="${CSS.escape(String(cel.r))}"]`);
  return tr?.cells?.[cel.c] || null;
}

const mesmaCelula = (a, b) => Boolean(a && b && a.t === b.t && a.r === b.r && a.c === b.c);
const ts = (p) => (p?.visto_em ? new Date(p.visto_em).getTime() : 0);

export default function Presenca({ nome, pagina }) {
  const [doBanco, setDoBanco] = useState([]);   // lista conferida no banco
  const [aoVivo, setAoVivo] = useState({});     // últimas mensagens ao vivo, por chave
  const [conectado, setConectado] = useState(false);
  const [erro, setErro] = useState(false);
  const chave = useRef(null);
  const canal = useRef(null);
  const meu = useRef({ nome, cor: corDoNome(nome), pagina, celula: null, mx: null, my: null, visivel: true });

  // ---------- enviar minha posição ----------
  const timerBanco = useRef(null);
  async function gravarAgora() {
    if (!chave.current) return;
    const m = meu.current;
    const { error } = await sb().from("presenca").upsert({
      chave: chave.current, nome: m.nome, cor: m.cor, pagina: m.pagina,
      celula: m.celula, visivel: m.visivel, visto_em: new Date().toISOString(),
    });
    setErro(Boolean(error));
  }
  function gravarLogo() {
    clearTimeout(timerBanco.current);
    timerBanco.current = setTimeout(gravarAgora, 400);
  }

  const ultimoEnvio = useRef(0);
  const envioPendente = useRef(null);
  function transmitir(ja = false) {
    const enviar = () => {
      ultimoEnvio.current = Date.now();
      envioPendente.current = null;
      const m = meu.current;
      try {
        canal.current?.send({
          type: "broadcast", event: "pos",
          payload: { chave: chave.current, nome: m.nome, cor: m.cor, pagina: m.pagina, celula: m.celula, mx: m.mx, my: m.my, visivel: m.visivel, visto_em: new Date().toISOString() },
        });
      } catch {}
    };
    if (ja) { clearTimeout(envioPendente.current); enviar(); return; }
    const falta = INTERVALO_MOUSE - (Date.now() - ultimoEnvio.current);
    if (falta <= 0) enviar();
    else if (!envioPendente.current) envioPendente.current = setTimeout(enviar, falta);
  }

  // ---------- ler a posição de todo mundo no banco ----------
  async function lerTodos() {
    const desde = new Date(Date.now() - ONLINE_FUNDO).toISOString();
    const { data, error } = await sb().from("presenca").select("*").gte("visto_em", desde);
    if (error) { setErro(true); return; }
    const lista = (data || []).filter((p) => p.chave !== chave.current && p.nome);
    setDoBanco((velha) => (JSON.stringify(velha) === JSON.stringify(lista) ? velha : lista));
  }

  useEffect(() => {
    if (!nome) return;
    chave.current = idCliente();
    meu.current = { ...meu.current, nome, cor: corDoNome(nome), visivel: !document.hidden };
    gravarAgora();
    lerTodos();

    const batida = setInterval(() => { gravarAgora(); transmitir(true); }, BATIMENTO);
    const leitura = setInterval(lerTodos, 2000);

    let t;
    const c = sb().channel("presenca-ao-vivo", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        if (!payload?.chave || payload.chave === chave.current) return;
        setAoVivo((v) => ({ ...v, [payload.chave]: { ...payload, visto_em: new Date().toISOString() } }));
      })
      .on("broadcast", { event: "saiu" }, ({ payload }) => {
        setAoVivo((v) => { const n = { ...v }; delete n[payload?.chave]; return n; });
        setDoBanco((l) => l.filter((p) => p.chave !== payload?.chave));
      })
      .on("broadcast", { event: "oi" }, () => transmitir(true))   // quem acabou de entrar pede a posição de todos
      .on("postgres_changes", { event: "*", schema: "public", table: "presenca" }, () => { clearTimeout(t); t = setTimeout(lerTodos, 80); })
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setConectado(ok);
        if (ok) {
          transmitir(true);
          try { c.send({ type: "broadcast", event: "oi", payload: {} }); } catch {}
        }
      });
    canal.current = c;

    // ao fechar a aba, sai da lista na hora
    const sair = () => {
      try { c.send({ type: "broadcast", event: "saiu", payload: { chave: chave.current } }); } catch {}
      try {
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/presenca?chave=eq.${chave.current}`, {
          method: "DELETE", keepalive: true,
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
        });
      } catch {}
    };
    window.addEventListener("pagehide", sair);

    // limpa da tela quem parou de mandar sinal ao vivo
    const faxina = setInterval(() => {
      setAoVivo((v) => {
        const agora = Date.now();
        const n = {};
        let mudou = false;
        for (const [k, p] of Object.entries(v)) {
          if (agora - ts(p) < (p.visivel === false ? ONLINE_FUNDO : ONLINE_ATIVO)) n[k] = p; else mudou = true;
        }
        return mudou ? n : v;
      });
    }, 3000);

    return () => {
      clearInterval(batida); clearInterval(leitura); clearInterval(faxina); clearTimeout(t);
      clearTimeout(envioPendente.current); clearTimeout(timerBanco.current);
      window.removeEventListener("pagehide", sair);
      canal.current = null;
      sb().removeChannel(c);
    };
  }, [nome]);

  // troca de página
  useEffect(() => {
    meu.current = { ...meu.current, pagina, celula: null, mx: null, my: null };
    transmitir(true);
    gravarLogo();
  }, [pagina]);

  // mouse / clique / digitação: célula + posição do mouse dentro dela
  useEffect(() => {
    const aoMover = (e) => {
      const achou = celulaDe(e.target);
      const m = meu.current;
      if (!achou) {
        if (m.mx === null) return;
        meu.current = { ...m, mx: null, my: null };  // saiu da tabela: esconde a setinha, mantém a célula
        transmitir();
        return;
      }
      const r = achou.td.getBoundingClientRect();
      const temMouse = typeof e.clientX === "number" && e.type !== "focusin";
      const mx = temMouse && r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : m.mx;
      const my = temMouse && r.height ? Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) : m.my;
      const trocou = !mesmaCelula(m.celula, achou.cel);
      meu.current = { ...m, celula: achou.cel, mx, my };
      transmitir(trocou);
      if (trocou) gravarLogo();
    };
    const aoTrocarAba = () => {
      meu.current = { ...meu.current, visivel: !document.hidden };
      transmitir(true);
      gravarAgora();
      if (!document.hidden) lerTodos();
    };
    document.addEventListener("pointermove", aoMover, { capture: true, passive: true });
    document.addEventListener("mousedown", aoMover, true);
    document.addEventListener("focusin", aoMover, true);
    document.addEventListener("visibilitychange", aoTrocarAba);
    return () => {
      document.removeEventListener("pointermove", aoMover, { capture: true });
      document.removeEventListener("mousedown", aoMover, true);
      document.removeEventListener("focusin", aoMover, true);
      document.removeEventListener("visibilitychange", aoTrocarAba);
    };
  }, []);

  // junta banco + ao vivo (vale o mais recente de cada pessoa)
  const agora = Date.now();
  const porChave = {};
  for (const p of doBanco) porChave[p.chave] = p;
  for (const p of Object.values(aoVivo)) {
    const b = porChave[p.chave];
    porChave[p.chave] = !b || ts(p) >= ts(b) ? { ...b, ...p } : b;
  }
  const outros = Object.values(porChave)
    .filter((p) => p.nome && agora - ts(p) < (p.visivel === false ? ONLINE_FUNDO : ONLINE_ATIVO))
    .map((p) => ({ key: p.chave, ...p }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const naMesmaPagina = outros.filter((p) => p.pagina === pagina && p.celula);

  return (
    <>
      <div className="presenca" title="Quem está no site agora">
        <span
          className={`presenca-sinal ${conectado ? "on" : ""}`}
          title={conectado ? "Ao vivo: o mouse aparece na hora" : "Modo seguro: atualiza a cada 2 segundos"}
        />
        {erro && <span className="presenca-so" title="Rode o arquivo 07_presenca.sql no Supabase">⚠ presença indisponível</span>}
        {!erro && outros.length === 0 && <span className="presenca-so">só você online</span>}
        {outros.map((p) => {
          const onde = [NOME_PAGINA[p.pagina] || p.pagina, p.celula?.d].filter(Boolean).join(" › ");
          return (
            <span
              key={p.key}
              className={`pessoa-online ${p.visivel === false ? "fundo" : ""}`}
              title={`${p.nome} — ${onde}${p.visivel === false ? " (em segundo plano)" : ""}`}
            >
              <span className="ponto" style={{ background: p.cor }} />
              <b>{p.nome.split(" ")[0]}</b>
              {p.visivel === false && <small>💤</small>}
            </span>
          );
        })}
      </div>
      {typeof document !== "undefined" && createPortal(<Marcadores pessoas={naMesmaPagina} />, document.body)}
    </>
  );
}

// cor com transparência (#rrggbb -> rgba)
function rgba(hex, a) {
  const h = String(hex || "#888").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Moldura discreta na célula + setinha do mouse de cada pessoa.
// Lê sempre a lista mais nova (ref) num laço de animação, então acompanha o mouse sem atraso extra.
function Marcadores({ pessoas }) {
  const [caixas, setCaixas] = useState([]);
  const atual = useRef(pessoas);
  atual.current = pessoas;

  useEffect(() => {
    let quadro;
    const medir = () => {
      const novas = [];
      atual.current.forEach((p) => {
        const td = acharCelula(p.celula);
        if (!td) return;
        const r = td.getBoundingClientRect();
        if (r.width === 0) return;
        const area = td.closest(".tabela-rolagem")?.getBoundingClientRect();
        if (area && (r.bottom < area.top + 20 || r.top > area.bottom || r.right < area.left || r.left > area.right)) return;
        const temMouse = p.mx != null && p.my != null && p.visivel !== false;
        novas.push({
          key: p.key, nome: p.nome.split(" ")[0], cor: p.cor, fundo: p.visivel === false,
          top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height),
          mx: temMouse ? Math.round(r.left + p.mx * r.width) : null,
          my: temMouse ? Math.round(r.top + p.my * r.height) : null,
        });
      });
      setCaixas((velhas) => (JSON.stringify(velhas) === JSON.stringify(novas) ? velhas : novas));
      quadro = requestAnimationFrame(medir);
    };
    medir();
    return () => cancelAnimationFrame(quadro);
  }, []);

  return (
    <>
      {caixas.map((c) => (
        <div key={c.key}>
          <div
            className={`marcador ${c.fundo ? "fundo" : ""}`}
            style={{ top: c.top, left: c.left, width: c.width, height: c.height, borderColor: rgba(c.cor, 0.75), background: rgba(c.cor, 0.07) }}
          >
            {c.mx == null && <span style={{ background: rgba(c.cor, 0.85) }}>{c.nome}{c.fundo ? " 💤" : ""}</span>}
          </div>
          {c.mx != null && (
            <div className="cursor-outro" style={{ transform: `translate(${c.mx}px, ${c.my}px)` }}>
              <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
                <path d="M1 1 L1 13 L4.5 9.8 L7 15 L9 14 L6.6 9 L11.5 9 Z" fill={c.cor} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              <span style={{ background: rgba(c.cor, 0.85) }}>{c.nome}</span>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
