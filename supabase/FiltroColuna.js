"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Filtro e classificação por coluna, no estilo do Excel.
// Uso:
//   const f = useFiltros(COLUNAS)                       // COLUNAS = { chave: { valor: (linha) => ..., numero?: true } }
//   const visiveis = f.aplicar(linhas)
//   <ThFiltro f={f} col="zona" linhas={linhas}>Zona</ThFiltro>

const VAZIO = "(Vazias)";
const txt = (v) => (v === null || v === undefined || v === "" ? VAZIO : String(v));

export function useFiltros(colunas) {
  const [ordem, setOrdem] = useState(null); // { col, dir: 1 | -1 }
  const [filtros, setFiltros] = useState({}); // col -> Set de valores permitidos

  function aplicar(linhas) {
    let res = linhas.filter((l) =>
      Object.entries(filtros).every(([col, permitidos]) => !permitidos || permitidos.has(txt(colunas[col].valor(l))))
    );
    if (ordem) {
      const { col, dir } = ordem;
      const def = colunas[col];
      res = [...res].sort((a, b) => {
        const va = def.valor(a), vb = def.valor(b);
        const vazioA = va === null || va === undefined || va === "";
        const vazioB = vb === null || vb === undefined || vb === "";
        if (vazioA || vazioB) return vazioA === vazioB ? 0 : vazioA ? 1 : -1; // vazios sempre no fim
        if (def.numero) return (Number(va) - Number(vb)) * dir;
        return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * dir;
      });
    }
    return res;
  }

  const ativos = Object.keys(filtros).filter((c) => filtros[c]).length + (ordem ? 1 : 0);
  function limparTudo() { setOrdem(null); setFiltros({}); }

  return { colunas, ordem, setOrdem, filtros, setFiltros, aplicar, ativos, limparTudo };
}

export function ThFiltro({ f, col, linhas, className = "", children }) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const botao = useRef(null);
  const def = f.colunas[col];
  const filtrado = Boolean(f.filtros[col]);
  const ordenado = f.ordem?.col === col;

  function abrir(e) {
    e.stopPropagation();
    const r = botao.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 270) });
    setAberto(!aberto);
  }

  return (
    <th className={`${className} th-filtro ${filtrado || ordenado ? "filtrado" : ""}`}>
      <span className="th-rotulo">{children}</span>
      <button ref={botao} className="btn-filtro nao-imprimir" title="Filtrar / classificar" onClick={abrir}>
        {ordenado ? (f.ordem.dir === 1 ? "▲" : "▼") : filtrado ? "⧩" : "▾"}
      </button>
      {aberto && createPortal(
        <PainelFiltro f={f} col={col} def={def} linhas={linhas} pos={pos} fechar={() => setAberto(false)} />,
        document.body
      )}
    </th>
  );
}

function PainelFiltro({ f, col, def, linhas, pos, fechar }) {
  const painel = useRef(null);
  const [busca, setBusca] = useState("");

  // valores distintos da coluna (considerando os outros filtros já aplicados, como no Excel)
  const valores = useMemo(() => {
    const outros = { ...f.filtros };
    delete outros[col];
    const base = linhas.filter((l) =>
      Object.entries(outros).every(([c, p]) => !p || p.has(txt(f.colunas[c].valor(l))))
    );
    const cont = new Map();
    base.forEach((l) => { const v = txt(def.valor(l)); cont.set(v, (cont.get(v) || 0) + 1); });
    return [...cont.entries()].sort((a, b) => {
      if (a[0] === VAZIO) return 1;
      if (b[0] === VAZIO) return -1;
      return def.numero ? Number(a[0]) - Number(b[0]) : a[0].localeCompare(b[0], "pt-BR", { numeric: true });
    });
  }, [linhas, f.filtros, col]);

  const [marcados, setMarcados] = useState(() => new Set(f.filtros[col] ? [...f.filtros[col]] : valores.map((v) => v[0])));

  useEffect(() => {
    const fora = (e) => { if (painel.current && !painel.current.contains(e.target)) fechar(); };
    const esc = (e) => { if (e.key === "Escape") fechar(); };
    setTimeout(() => document.addEventListener("mousedown", fora), 0);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, []);

  const b = busca.trim().toUpperCase();
  const lista = valores.filter(([v]) => !b || v.toUpperCase().includes(b));
  const todosMarcados = lista.every(([v]) => marcados.has(v));

  function alternar(v) {
    const n = new Set(marcados);
    n.has(v) ? n.delete(v) : n.add(v);
    setMarcados(n);
  }
  function alternarTodos() {
    const n = new Set(marcados);
    lista.forEach(([v]) => (todosMarcados ? n.delete(v) : n.add(v)));
    setMarcados(n);
  }
  function ok() {
    const tudo = valores.every(([v]) => marcados.has(v)) && !b;
    const nf = { ...f.filtros };
    if (tudo) delete nf[col];
    else nf[col] = b ? new Set(lista.filter(([v]) => marcados.has(v)).map(([v]) => v)) : new Set(marcados);
    f.setFiltros(nf);
    fechar();
  }
  function limpar() {
    const nf = { ...f.filtros };
    delete nf[col];
    f.setFiltros(nf);
    if (f.ordem?.col === col) f.setOrdem(null);
    fechar();
  }
  function classificar(dir) {
    f.setOrdem({ col, dir });
    fechar();
  }

  return (
    <div ref={painel} className="painel-filtro" style={{ top: pos.top, left: pos.left }}>
      <button className="pf-item" onClick={() => classificar(1)}>{def.numero ? "↑ Classificar do menor para o maior" : "↑ Classificar de A a Z"}</button>
      <button className="pf-item" onClick={() => classificar(-1)}>{def.numero ? "↓ Classificar do maior para o menor" : "↓ Classificar de Z a A"}</button>
      <hr />
      <input className="campo pf-busca" placeholder="Pesquisar…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
      <div className="pf-lista">
        <label className="pf-valor"><input type="checkbox" checked={todosMarcados} onChange={alternarTodos} /> <b>(Selecionar tudo)</b></label>
        {lista.map(([v, n]) => (
          <label key={v} className="pf-valor">
            <input type="checkbox" checked={marcados.has(v)} onChange={() => alternar(v)} />
            <span>{v}</span><small>{n}</small>
          </label>
        ))}
      </div>
      <div className="pf-acoes">
        <button className="btn link" onClick={limpar}>Limpar</button>
        <button className="btn mini" onClick={fechar}>Cancelar</button>
        <button className="btn primario mini" onClick={ok}>OK</button>
      </div>
    </div>
  );
}
