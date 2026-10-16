"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import CampoEditavel from "../../components/CampoEditavel";
import { useColunas } from "../../lib/colunas";
import { useTempoReal } from "../../lib/hooks";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { ligarPessoas, ehDiarista, normNome, GM } from "../../lib/cadastro";

// Cadastro padronizado de motoristas e entregadores.
// É dessa lista que saem as opções nas colunas Motorista / Entregadores do Frete.
// Separado em FIXOS e DIARISTAS (DG), com a situação de cada um no GreenMile (GM):
// apto = cadastrado no Winthor E no RoadNet com o mesmo nome.

const FUNCOES = ["MOTORISTA", "ENTREGADOR", "AMBOS"];
const ABAS = [
  { k: "FIXO", t: "Fixos" },
  { k: "DIARISTA", t: "Diaristas (DG)" },
  { k: "CADASTRO", t: "Winthor × RoadNet" },
];
const SIT_CAD = {
  OK: { rot: "Nos dois", classe: "gm-ok" },
  GRAFIA: { rot: "Nome diferente", classe: "gm-aviso" },
  POSSIVEL: { rot: "Provável mesma pessoa", classe: "gm-aviso" },
  SO_WINTHOR: { rot: "Só no Winthor", classe: "gm-pend" },
  SO_ROADNET: { rot: "Só no RoadNet", classe: "gm-pend" },
};

const COLUNAS = {
  nome: { valor: (p) => p.nome },
  funcao: { valor: (p) => p.funcao },
  oficial: { valor: (p) => p.cadastro?.nome || (p.cands.length ? `(${p.cands.length} possível)` : "—") },
  winthor: { valor: (p) => (p.cadastro?.nome_winthor ? "SIM" : "NÃO") },
  roadnet: { valor: (p) => (p.cadastro?.nome_roadnet ? "SIM" : "NÃO") },
  gm: { valor: (p) => p.gm.rot },
  ativo: { valor: (p) => (p.ativo ? "ATIVO" : "INATIVO") },
  usos: { valor: (p) => p.usos, numero: true },
};
const COLUNAS_CAD = {
  situacao: { valor: (c) => SIT_CAD[c.situacao]?.rot || c.situacao },
  winthor: { valor: (c) => c.nome_winthor || "—" },
  matricula: { valor: (c) => c.matricula_winthor || "—" },
  roadnet: { valor: (c) => c.nome_roadnet || "—" },
  idrn: { valor: (c) => c.id_roadnet || "—" },
  site: { valor: (c) => (c.nomesSite.length ? "SIM" : "NÃO") },
};

export default function Pessoas() {
  const [lista, setLista] = useState([]);
  const [cadastro, setCadastro] = useState([]);
  const [semTabela, setSemTabela] = useState(false);
  const [usos, setUsos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState("FIXO");
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState({ nome: "", funcao: "AMBOS" });
  const [marcados, setMarcados] = useState(new Set());
  const f = useFiltros(COLUNAS);
  const fc = useFiltros(COLUNAS_CAD);

  async function carregar() {
    const [p, s, c] = await Promise.all([
      buscarTudo(() => sb().from("pessoas").select("*").order("nome")),
      buscarTudo(() => sb().from("saidas").select("motorista,entregador")),
      buscarTudo(() => sb().from("cadastro_gm").select("*").order("nome")).catch(() => null),
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
    setCadastro(c || []);
    setSemTabela(c === null);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useTempoReal(carregar, []);

  async function atualizar(id, campos) {
    const { error } = await sb().from("pessoas").update(campos).eq("id", id);
    if (error) {
      if (/vinculo|cadastro_nome/i.test(error.message || "")) throw new Error("Rode o arquivo 13_cadastro_gm.sql no Supabase para ativar essa coluna.");
      throw new Error(error.code === "23505" ? "Esse nome já existe no cadastro." : error.message);
    }
    setLista((ls) => ls.map((p) => (p.id === id ? { ...p, ...campos } : p)));
  }
  const atualizarAlerta = (id, campos) => atualizar(id, campos).catch((er) => alert(er.message));

  async function adicionar(e) {
    e.preventDefault();
    const nome = novo.nome.trim().toUpperCase().replace(/\s+/g, " ");
    if (!nome) return;
    const linha = { nome, funcao: novo.funcao };
    // o novo nome entra na aba em que você está (Fixos ou Diaristas); "DG" no nome = diarista
    const vinculo = aba === "DIARISTA" || ehDiarista(nome) ? "DIARISTA" : "FIXO";
    let { error } = await sb().from("pessoas").insert({ ...linha, vinculo });
    if (error && /vinculo/i.test(error.message || "")) ({ error } = await sb().from("pessoas").insert(linha));
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

  async function moverMarcados(vinculo) {
    if (!marcados.size) return;
    const { error } = await sb().from("pessoas").update({ vinculo }).in("id", [...marcados]);
    if (error) return alert(/vinculo/i.test(error.message || "") ? "Rode o arquivo 13_cadastro_gm.sql no Supabase primeiro." : error.message);
    setMarcados(new Set());
    carregar();
  }

  // vínculo: o que está gravado; se o banco ainda não tem a coluna, "DG" no nome = diarista
  const ligadas = useMemo(() => ligarPessoas(
    lista.map((p) => ({ ...p, vinculo: p.vinculo || (ehDiarista(p.nome) ? "DIARISTA" : "FIXO"), usos: usos[p.nome] || 0 })),
    cadastro,
  ), [lista, cadastro, usos]);

  const daAba = useMemo(() => {
    const b = normNome(busca);
    return ligadas.filter((p) => p.vinculo === aba && (!b || b.split(" ").every((t) => normNome(p.nome).includes(t) || normNome(p.cadastro?.nome).includes(t))));
  }, [ligadas, aba, busca]);
  const visiveis = f.aplicar(daAba);

  // aba Winthor × RoadNet: cada pessoa do cadastro e os nomes do site ligados a ela
  const cadComSite = useMemo(() => {
    const m = new Map(cadastro.map((c) => [c.nome, []]));
    ligadas.forEach((p) => { if (p.cadastro) m.get(p.cadastro.nome)?.push(p.nome); });
    const b = normNome(busca);
    return cadastro
      .map((c) => ({ ...c, nomesSite: m.get(c.nome) || [] }))
      .filter((c) => !b || b.split(" ").every((t) => normNome(`${c.nome} ${c.nome_roadnet || ""}`).includes(t)));
  }, [cadastro, ligadas, busca]);
  const cadVisiveis = fc.aplicar(cadComSite);

  const [refTabela, ajustarColunas] = useColunas(`pessoas-${aba}`, `${carregando}-${visiveis.length}-${cadVisiveis.length}`);

  const todosMarcados = visiveis.length > 0 && visiveis.every((p) => marcados.has(p.id));
  function alternarTodos() {
    const n = new Set(marcados);
    visiveis.forEach((p) => (todosMarcados ? n.delete(p.id) : n.add(p.id)));
    setMarcados(n);
  }

  // resumo do GM (só ativos)
  const resumo = (vinc) => {
    const at = ligadas.filter((p) => p.vinculo === vinc && p.ativo);
    const c = (g) => at.filter((p) => p.gm === g).length;
    return { total: at.length, apto: c(GM.APTO), grafia: c(GM.GRAFIA), faltaRn: c(GM.FALTA_RN), faltaWt: c(GM.FALTA_WT), sem: c(GM.SEM), escolher: c(GM.ESCOLHER) };
  };
  const rFixo = resumo("FIXO");
  const qtd = { FIXO: ligadas.filter((p) => p.vinculo === "FIXO").length, DIARISTA: ligadas.filter((p) => p.vinculo === "DIARISTA").length, CADASTRO: cadastro.length };

  return (
    <>
      <div className="abas-pessoas">
        {ABAS.map((a) => (
          <button key={a.k} className={`aba-p ${aba === a.k ? "ativa" : ""}`} onClick={() => { setAba(a.k); setMarcados(new Set()); f.limparTudo(); }}>
            {a.t} <small>{qtd[a.k]}</small>
          </button>
        ))}
      </div>

      {semTabela && (
        <div className="alerta aviso">Para ver quem está apto no GreenMile, rode o arquivo <b>13_cadastro_gm.sql</b> no Supabase (SQL Editor › Run).</div>
      )}

      {aba === "FIXO" && cadastro.length > 0 && (
        <section className="kpis gm-kpis">
          <div className="kpi verde" title={GM.APTO.dica}><span>Aptos no GM</span><b>{rFixo.apto} / {rFixo.total}</b>
            <div className="barra"><i style={{ width: `${rFixo.total ? (rFixo.apto / rFixo.total) * 100 : 0}%` }} /></div></div>
          <div className="kpi laranja" title={GM.GRAFIA.dica}><span>Nome diferente</span><b>{rFixo.grafia}</b></div>
          <div className="kpi laranja" title={GM.FALTA_RN.dica}><span>Falta RoadNet</span><b>{rFixo.faltaRn}</b></div>
          <div className="kpi laranja" title={GM.FALTA_WT.dica}><span>Falta Winthor</span><b>{rFixo.faltaWt}</b></div>
          <div className="kpi" title={GM.ESCOLHER.dica}><span>Ligar ao cadastro</span><b>{rFixo.escolher}</b></div>
          <div className="kpi" title={GM.SEM.dica}><span>Sem cadastro</span><b>{rFixo.sem}</b></div>
        </section>
      )}

      {aba !== "CADASTRO" && (
        <form className="cartao form-linha" onSubmit={adicionar}>
          <b>Novo nome {aba === "DIARISTA" ? "(diarista)" : "(fixo)"}:</b>
          <input className="campo" placeholder={aba === "DIARISTA" ? "Ex.: DG JOAO VITOR" : "Nome completo"} value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value.toUpperCase() })} style={{ minWidth: 320 }} />
          <select className="campo" value={novo.funcao} onChange={(e) => setNovo({ ...novo, funcao: e.target.value })}>
            {FUNCOES.map((x) => <option key={x}>{x}</option>)}
          </select>
          <button className="btn primario">Cadastrar</button>
          <span className="sub">Dica: pesquise o primeiro nome para achar grafias repetidas e exclua as erradas.</span>
        </form>
      )}

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="linha-acoes">
            <input className="campo" placeholder="Pesquisar nome…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 260 }} />
            {aba !== "CADASTRO" && marcados.size > 0 && (
              <>
                <button className="btn" onClick={() => moverMarcados(aba === "FIXO" ? "DIARISTA" : "FIXO")}>
                  ⇄ Mover {marcados.size} para {aba === "FIXO" ? "Diaristas" : "Fixos"}
                </button>
                <button className="btn" onClick={excluirMarcados}>🗑 Excluir {marcados.size}</button>
              </>
            )}
            {(aba === "CADASTRO" ? fc.ativos : f.ativos) > 0 && <button className="btn link" onClick={() => (aba === "CADASTRO" ? fc : f).limparTudo()}>✕ limpar filtros</button>}
          </div>
          <div className="linha-acoes">
            <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
            <span className="sub">
              {aba === "CADASTRO"
                ? `${cadVisiveis.length} de ${cadastro.length} pessoa(s) no Winthor (4A) / RoadNet`
                : `${visiveis.length} de ${qtd[aba]} nome(s) · ${daAba.filter((p) => p.ativo).length} ativos`}
            </span>
          </div>
        </div>

        {carregando ? <div className="carregando">Carregando…</div> : aba === "CADASTRO" ? (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela="pessoas-cadastro">
              <thead>
                <tr>
                  <ThFiltro f={fc} col="situacao" linhas={cadComSite}>Situação</ThFiltro>
                  <ThFiltro f={fc} col="winthor" linhas={cadComSite}>Nome no Winthor</ThFiltro>
                  <ThFiltro f={fc} col="matricula" linhas={cadComSite}>Matrícula</ThFiltro>
                  <ThFiltro f={fc} col="roadnet" linhas={cadComSite}>Nome no RoadNet</ThFiltro>
                  <ThFiltro f={fc} col="idrn" linhas={cadComSite}>ID RoadNet</ThFiltro>
                  <ThFiltro f={fc} col="site" linhas={cadComSite}>Na lista do site</ThFiltro>
                </tr>
              </thead>
              <tbody>
                {cadVisiveis.map((c) => (
                  <tr key={c.id}>
                    <td><span className={`gm ${SIT_CAD[c.situacao]?.classe || ""}`}>{SIT_CAD[c.situacao]?.rot || c.situacao}</span></td>
                    <td>{c.nome_winthor || <span className="sub">—</span>}</td>
                    <td>{c.matricula_winthor || <span className="sub">—</span>}</td>
                    <td className={c.situacao === "GRAFIA" || c.situacao === "POSSIVEL" ? "t-laranja" : ""}>{c.nome_roadnet || <span className="sub">—</span>}</td>
                    <td>{c.id_roadnet || <span className="sub">—</span>}</td>
                    <td>{c.nomesSite.length ? c.nomesSite.join(" · ") : <span className="sub">não está na lista do site</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela={`pessoas-${aba}`}>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={todosMarcados} onChange={alternarTodos} /></th>
                  <ThFiltro f={f} col="nome" linhas={daAba}>Nome no site</ThFiltro>
                  <ThFiltro f={f} col="funcao" linhas={daAba}>Função</ThFiltro>
                  <ThFiltro f={f} col="oficial" linhas={daAba}>Cadastro oficial (Winthor / RoadNet)</ThFiltro>
                  <ThFiltro f={f} col="winthor" linhas={daAba} className="c">Winthor</ThFiltro>
                  <ThFiltro f={f} col="roadnet" linhas={daAba} className="c">RoadNet</ThFiltro>
                  <ThFiltro f={f} col="gm" linhas={daAba}>GreenMile</ThFiltro>
                  <ThFiltro f={f} col="ativo" linhas={daAba}>Ativo</ThFiltro>
                  <ThFiltro f={f} col="usos" linhas={daAba} className="n">Vezes usado</ThFiltro>
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
                      <select className="campo-ed" value={p.funcao} onChange={(e) => atualizarAlerta(p.id, { funcao: e.target.value })}>
                        {FUNCOES.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </td>
                    <td><LigarCadastro p={p} cadastro={cadastro} aoLigar={(nome) => atualizarAlerta(p.id, { cadastro_nome: nome })} /></td>
                    <td className="c">{p.cadastro ? (p.cadastro.nome_winthor ? <span className="ok-x ok">✓</span> : <span className="ok-x nao">✗</span>) : ""}</td>
                    <td className="c">{p.cadastro ? (p.cadastro.nome_roadnet ? <span className="ok-x ok">✓</span> : <span className="ok-x nao">✗</span>) : ""}</td>
                    <td><span className={`gm ${p.gm.classe}`} title={p.gm.dica}>{p.gm.rot}</span></td>
                    <td className="c"><input type="checkbox" checked={p.ativo} onChange={(e) => atualizarAlerta(p.id, { ativo: e.target.checked })} /></td>
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

// Escolher a qual pessoa do cadastro oficial um nome do site corresponde
function LigarCadastro({ p, cadastro, aoLigar }) {
  if (!cadastro.length) return <span className="sub">—</span>;
  const sugest = p.cands.map((c) => c.nome);
  const valor = p.cadastro_nome || "";
  const outros = cadastro.map((c) => c.nome).filter((n) => !sugest.includes(n));
  return (
    <span className="ligar-cad">
      <select className={`campo-ed ${p.ligacao === "auto" ? "auto" : ""} ${!p.cadastro && p.cands.length ? "escolher" : ""}`} value={valor}
        title={p.ligacao === "auto" ? "Ligado automaticamente (nome único no cadastro). Escolha outro se estiver errado." : ""}
        onChange={(e) => aoLigar(e.target.value || null)}>
        <option value="">
          {p.ligacao === "auto" ? `${p.cadastro.nome} (auto)`
            : valor ? "— desfazer a ligação —"
            : p.cands.length ? `— escolher (${p.cands.length} possível) —` : "— não encontrado —"}
        </option>
        {sugest.length > 0 && <optgroup label="Sugestões">{sugest.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>}
        <optgroup label="Todos do cadastro">{outros.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>
      </select>
    </span>
  );
}
