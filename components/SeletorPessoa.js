"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sb } from "../lib/supabase";

// Lista padronizada de motoristas/entregadores (tabela "pessoas"), compartilhada pela página
export function usePessoas() {
  const [pessoas, setPessoas] = useState([]);
  async function carregar() {
    const { data } = await sb().from("pessoas").select("*").eq("ativo", true).order("nome");
    setPessoas(data || []);
  }
  useEffect(() => { carregar(); }, []);

  async function cadastrar(nome, funcao) {
    const n = nome.trim().toUpperCase().replace(/\s+/g, " ");
    if (!n) return null;
    const { data, error } = await sb().from("pessoas").insert({ nome: n, funcao }).select().single();
    if (error && error.code !== "23505") { alert(error.message); return null; }
    await carregar();
    return n;
  }
  return { pessoas, cadastrar, recarregar: carregar };
}

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const SEP = " / ";

// Campo de seleção com pesquisa (igual a uma lista suspensa do Excel, mas com busca).
// funcao: "MOTORISTA" | "ENTREGADOR" — mostra quem tem essa função (ou AMBOS)
// multiplo: permite escolher mais de um (ex.: entregador + diarista), gravados como "A / B"
export default function SeletorPessoa({ valor, aoSalvar, funcao, multiplo = false, placeholder = "selecionar…", lista }) {
  const { pessoas, cadastrar } = lista;
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 260 });
  const botao = useRef(null);

  function abrir() {
    const r = botao.current.getBoundingClientRect();
    const alturaPainel = 330;
    const top = r.bottom + alturaPainel > window.innerHeight ? Math.max(8, r.top - alturaPainel - 4) : r.bottom + 2;
    setPos({ top, left: Math.min(r.left, window.innerWidth - 300), width: Math.max(r.width, 280) });
    setAberto(true);
  }

  const vazio = !valor;
  return (
    <>
      <span className="so-imprimir">{valor}</span>
      <button
        ref={botao}
        type="button"
        className={`campo-ed seletor nao-imprimir ${vazio ? "falta" : ""}`}
        onClick={abrir}
        title={valor || ""}
      >
        <span className={vazio ? "seletor-ph" : ""}>{valor || placeholder}</span>
        <i>▾</i>
      </button>
      {aberto && createPortal(
        <Painel
          valor={valor} pessoas={pessoas} funcao={funcao} multiplo={multiplo} pos={pos}
          fechar={() => setAberto(false)}
          salvar={async (v) => { setAberto(false); if (v !== (valor || "")) await aoSalvar(v); }}
          cadastrar={cadastrar}
        />,
        document.body
      )}
    </>
  );
}

function Painel({ valor, pessoas, funcao, multiplo, pos, fechar, salvar, cadastrar }) {
  const painel = useRef(null);
  const busca = useRef(null);
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [marcados, setMarcados] = useState(() => (valor ? valor.split(SEP).map((s) => s.trim()).filter(Boolean) : []));

  useEffect(() => {
    busca.current?.focus();
    const fora = (e) => { if (painel.current && !e.composedPath().includes(painel.current)) fechar(); };
    const t = setTimeout(() => document.addEventListener("mousedown", fora), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", fora); };
  }, []);

  const daFuncao = (p) => !funcao || p.funcao === "AMBOS" || p.funcao === funcao;
  const termo = semAcento(q.trim());
  const opcoes = useMemo(() => {
    const base = pessoas.filter(daFuncao);
    const outras = termo ? pessoas.filter((p) => !daFuncao(p)) : []; // ao pesquisar, mostra também os de outra função
    return [...base, ...outras]
      .filter((p) => !termo || termo.split(" ").every((t) => semAcento(p.nome).includes(t)))
      .slice(0, 80);
  }, [pessoas, termo]);
  const existeExato = pessoas.some((p) => semAcento(p.nome) === termo);

  function escolher(nome) {
    if (!multiplo) return salvar(nome);
    setMarcados((m) => (m.includes(nome) ? m.filter((x) => x !== nome) : [...m, nome]));
    setQ("");
    busca.current?.focus();
  }

  async function novo() {
    const n = await cadastrar(q, funcao || "AMBOS");
    if (n) escolher(n);
  }

  function teclas(e) {
    if (e.key === "Escape") return fechar();
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((a) => Math.min(a + 1, opcoes.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (opcoes[ativo]) escolher(opcoes[ativo].nome);
      else if (multiplo && !q) salvar(marcados.join(SEP));
    }
  }

  return (
    <div ref={painel} className="painel-filtro painel-pessoa" style={{ top: pos.top, left: pos.left, width: pos.width }}>
      {multiplo && marcados.length > 0 && (
        <div className="chips">
          {marcados.map((m) => <span key={m} className="chip" onClick={() => escolher(m)}>{m} ✕</span>)}
        </div>
      )}
      <input
        ref={busca}
        className="campo pf-busca"
        placeholder={`Pesquisar ${funcao === "MOTORISTA" ? "motorista" : funcao === "ENTREGADOR" ? "entregador" : "nome"}…`}
        value={q}
        onChange={(e) => { setQ(e.target.value); setAtivo(0); }}
        onKeyDown={teclas}
      />
      <div className="pf-lista">
        {opcoes.map((p, i) => {
          const sel = multiplo ? marcados.includes(p.nome) : p.nome === valor;
          return (
            <div
              key={p.id}
              className={`pp-opcao ${i === ativo ? "ativo" : ""} ${sel ? "sel" : ""}`}
              onMouseEnter={() => setAtivo(i)}
              onMouseDown={(e) => { e.preventDefault(); escolher(p.nome); }}
            >
              {multiplo && <input type="checkbox" readOnly checked={sel} />}
              <span>{p.nome}</span>
              {!daFuncao(p) && <small>{p.funcao.toLowerCase()}</small>}
            </div>
          );
        })}
        {opcoes.length === 0 && <div className="pp-vazio">Nenhum nome encontrado.</div>}
      </div>
      {q.trim() && !existeExato && (
        <button className="pf-item pp-novo" onMouseDown={(e) => { e.preventDefault(); novo(); }}>
          ＋ Cadastrar “{q.trim().toUpperCase()}”
        </button>
      )}
      <div className="pf-acoes">
        <button className="btn link" onMouseDown={(e) => { e.preventDefault(); salvar(""); }}>Limpar</button>
        <button className="btn mini" onClick={fechar}>Cancelar</button>
        {multiplo && <button className="btn primario mini" onClick={() => salvar(marcados.join(SEP))}>OK</button>}
      </div>
    </div>
  );
}
