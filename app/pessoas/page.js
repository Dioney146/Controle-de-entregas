"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import CampoEditavel from "../../components/CampoEditavel";
import { useColunas } from "../../lib/colunas";
import { useTempoReal } from "../../lib/hooks";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";

// Cadastro padronizado de motoristas e entregadores.
// É dessa lista que saem as opções nas colunas Motorista / Entregadores do Frete.

const FUNCOES = ["MOTORISTA", "ENTREGADOR", "AMBOS"];
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const COLUNAS = {
  nome: { valor: (p) => p.nome },
  funcao: { valor: (p) => p.funcao },
  ativo: { valor: (p) => (p.ativo ? "ATIVO" : "INATIVO") },
  usos: { valor: (p) => p.usos, numero: true },
};

export default function Pessoas() {
  const [lista, setLista] = useState([]);
  const [usos, setUsos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState({ nome: "", funcao: "AMBOS" });
  const [marcados, setMarcados] = useState(new Set());
  const f = useFiltros(COLUNAS);

  async function carregar() {
    const [p, s] = await Promise.all([
      buscarTudo(() => sb().from("pessoas").select("*").order("nome")),
      buscarTudo(() => sb().from("saidas").select("motorista,entregador")),
    ]);
    // quantas vezes cada nome aparece nas saídas (ajuda a achar nomes repetidos/errados)
    const cont = {};
    (s || []).forEach((x) => {
      [...(x.motorista || "").split(/[()/+,]/), ...(x.entregador || "").split(/[()/+,]/)].forEach((n) => {
        const k = (n || "").trim().toUpperCase();
        if (k) cont[k] = (cont[k] || 0) + 1;
      });
    });
    setUsos(cont);
    setLista(p || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useTempoReal(carregar, []);

  async function atualizar(id, campos) {
    const { error } = await sb().from("pessoas").update(campos).eq("id", id);
    if (error) throw new Error(error.code === "23505" ? "Esse nome já existe no cadastro." : error.message);
    setLista((ls) => ls.map((p) => (p.id === id ? { ...p, ...campos } : p)));
  }

  async function adicionar(e) {
    e.preventDefault();
    const nome = novo.nome.trim().toUpperCase().replace(/\s+/g, " ");
    if (!nome) return;
    const { error } = await sb().from("pessoas").insert({ nome, funcao: novo.funcao });
    if (error) return alert(error.code === "23505" ? "Esse nome já está cadastrado." : error.message);
    setNovo({ nome: "", funcao: novo.funcao });
    carregar();
  }

  async function excluirMarcados() {
    if (!marcados.size || !confirm(`Excluir ${marcados.size} nome(s) do cadastro?\n(O que já foi gravado no frete/histórico não muda.)`)) return;
    const { error } = await sb().from("pessoas").delete().in("id", [...marcados]);
    if (error) return alert(error.message);
    setMarcados(new Set());
    carregar();
  }

  const comUso = useMemo(() => lista.map((p) => ({ ...p, usos: usos[p.nome] || 0 })), [lista, usos]);
  const base = useMemo(() => {
    const b = semAcento(busca.trim());
    return comUso.filter((p) => !b || b.split(" ").every((t) => semAcento(p.nome).includes(t)));
  }, [comUso, busca]);
  const visiveis = f.aplicar(base);
  const [refTabela, ajustarColunas] = useColunas("pessoas", `${carregando}-${visiveis.length}`);

  const todosMarcados = visiveis.length > 0 && visiveis.every((p) => marcados.has(p.id));
  function alternarTodos() {
    const n = new Set(marcados);
    visiveis.forEach((p) => (todosMarcados ? n.delete(p.id) : n.add(p.id)));
    setMarcados(n);
  }

  return (
    <>
      <form className="cartao form-linha" onSubmit={adicionar}>
        <b>Novo nome:</b>
        <input className="campo" placeholder="Nome completo" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value.toUpperCase() })} style={{ minWidth: 320 }} />
        <select className="campo" value={novo.funcao} onChange={(e) => setNovo({ ...novo, funcao: e.target.value })}>
          {FUNCOES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <button className="btn primario">Cadastrar</button>
        <span className="sub">Dica: pesquise o primeiro nome para achar grafias repetidas (ex.: FRENCK) e exclua as erradas.</span>
      </form>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="linha-acoes">
            <input className="campo" placeholder="Pesquisar nome…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
            {marcados.size > 0 && <button className="btn" onClick={excluirMarcados}>🗑 Excluir {marcados.size} selecionado(s)</button>}
            {f.ativos > 0 && <button className="btn link" onClick={f.limparTudo}>✕ limpar filtros</button>}
          </div>
          <div className="linha-acoes">
            <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
            <span className="sub">{visiveis.length} de {lista.length} nome(s) · {lista.filter((p) => p.ativo).length} ativos</span>
          </div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela="pessoas">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={todosMarcados} onChange={alternarTodos} /></th>
                  <ThFiltro f={f} col="nome" linhas={base}>Nome</ThFiltro>
                  <ThFiltro f={f} col="funcao" linhas={base}>Função</ThFiltro>
                  <ThFiltro f={f} col="ativo" linhas={base}>Ativo</ThFiltro>
                  <ThFiltro f={f} col="usos" linhas={base} className="n">Vezes usado</ThFiltro>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => (
                  <tr key={p.id} data-id={p.id} data-ref={p.nome} className={p.ativo ? "" : "l-fora"}>
                    <td className="c">
                      <input type="checkbox" checked={marcados.has(p.id)} onChange={() => {
                        const n = new Set(marcados); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setMarcados(n);
                      }} />
                    </td>
                    <td><CampoEditavel valor={p.nome} aoSalvar={(v) => atualizar(p.id, { nome: v.replace(/\s+/g, " ") })} /></td>
                    <td>
                      <select className="campo-ed" value={p.funcao} onChange={(e) => atualizar(p.id, { funcao: e.target.value }).catch((er) => alert(er.message))}>
                        {FUNCOES.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </td>
                    <td className="c"><input type="checkbox" checked={p.ativo} onChange={(e) => atualizar(p.id, { ativo: e.target.checked }).catch((er) => alert(er.message))} /></td>
                    <td className="n">{p.usos || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
