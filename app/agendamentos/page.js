"use client";

import { useEffect, useMemo, useState } from "react";
import { sb, buscarTudo } from "../../lib/supabase";
import { useTempoReal } from "../../lib/hooks";
import { useColunas } from "../../lib/colunas";
import { useUsuario } from "../../components/Casca";
import CampoEditavel from "../../components/CampoEditavel";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { lerColagem, lerNumeros, ETAPAS, etapa } from "../../lib/agendamentos";
import { hojeISO, somarDias, fmtData, num, moeda } from "../../lib/util";

// Agendamentos: pedidos montados no dia (colados do RoadNet) e quantos já foram
// agendados, faturados e entregues.

const COLUNAS = {
  etapa: { valor: (a) => ETAPAS[etapa(a)].rot },
  montado: { valor: (a) => a.montado_em },
  cliente: { valor: (a) => a.cliente },
  pedido: { valor: (a) => a.pedido },
  instrucoes: { valor: (a) => a.instrucoes },
  valor: { valor: (a) => a.valor, numero: true },
  peso: { valor: (a) => a.peso, numero: true },
  saida: { valor: (a) => a.data_saida || "" },
  agendado: { valor: (a) => a.agendado_para || "" },
  nf: { valor: (a) => a.nota_fiscal },
};

export default function Agendamentos() {
  const { email } = useUsuario();
  const hoje = hojeISO();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [semTabela, setSemTabela] = useState(false);
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(hoje);
  const [pendentesTodos, setPendentesTodos] = useState(false);
  const [filtroEtapa, setFiltroEtapa] = useState("");
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState(new Set());
  const [dataSel, setDataSel] = useState(hoje);
  const [msg, setMsg] = useState(null);
  // colar do RoadNet
  const [abrirColar, setAbrirColar] = useState(false);
  const [texto, setTexto] = useState("");
  const [dataMontagem, setDataMontagem] = useState(hoje);
  const [salvando, setSalvando] = useState(false);
  // marcar em lote colando números de pedido
  const [abrirLote, setAbrirLote] = useState(false);
  const [textoLote, setTextoLote] = useState("");
  const [acaoLote, setAcaoLote] = useState("FATURADO");
  const [dataLote, setDataLote] = useState(hoje);
  const f = useFiltros(COLUNAS);

  async function carregar() {
    try {
      const q = () => {
        let c = sb().from("agendamentos").select("*");
        return pendentesTodos ? c.eq("entregue", false) : c.gte("montado_em", de).lte("montado_em", ate);
      };
      const d = await buscarTudo(() => q().order("montado_em", { ascending: false }).order("cliente").order("pedido"));
      setLista(d || []);
      setSemTabela(false);
    } catch (e) {
      setSemTabela(/agendamentos|relation|schema cache/i.test(e?.message || ""));
      setLista([]);
    }
    setCarregando(false);
  }
  useEffect(() => { setCarregando(true); carregar(); }, [de, ate, pendentesTodos]);
  useTempoReal(carregar, [de, ate, pendentesTodos]);

  const previa = useMemo(() => (texto.trim() ? lerColagem(texto) : null), [texto]);

  // ---------- colar / importar ----------
  async function importar() {
    if (!previa?.pedidos.length) return;
    setSalvando(true);
    try {
      const nums = previa.pedidos.map((p) => p.pedido);
      const existentes = [];
      for (let i = 0; i < nums.length; i += 200) {
        const { data, error } = await sb().from("agendamentos").select("id,pedido").in("pedido", nums.slice(i, i + 200));
        if (error) throw error;
        existentes.push(...(data || []));
      }
      const jaTem = new Map(existentes.map((x) => [x.pedido, x.id]));
      const novos = previa.pedidos.filter((p) => !jaTem.has(p.pedido)).map((p) => ({ ...p, montado_em: dataMontagem, importado_por: email || null }));
      const velhos = previa.pedidos.filter((p) => jaTem.has(p.pedido));
      if (novos.length) {
        const { error } = await sb().from("agendamentos").insert(novos);
        if (error) throw error;
      }
      // já existia: atualiza só os dados do RoadNet (valor, itens, instruções...); a etapa fica como está
      for (const p of velhos) {
        const { error } = await sb().from("agendamentos").update(p).eq("id", jaTem.get(p.pedido));
        if (error) throw error;
      }
      setMsg({ tipo: "ok", txt: `${novos.length} pedido(s) novo(s) montado(s) em ${fmtData(dataMontagem)}${velhos.length ? ` · ${velhos.length} já estavam no site (dados do RoadNet atualizados, etapa mantida)` : ""}.` });
      setTexto(""); setAbrirColar(false);
      if (dataMontagem < de || dataMontagem > ate) { setDe(dataMontagem); setAte(dataMontagem); }
      carregar();
    } catch (e) {
      setMsg({ tipo: "erro", txt: e.message });
    }
    setSalvando(false);
  }

  // ---------- etapas ----------
  async function atualizar(ids, campos) {
    const { error } = await sb().from("agendamentos").update(campos).in("id", ids);
    if (error) return setMsg({ tipo: "erro", txt: error.message });
    setLista((ls) => ls.map((a) => (ids.includes(a.id) ? { ...a, ...campos } : a)));
  }
  const camposEtapa = (acao, data) => ({
    AGENDADO: { agendado_para: data || hoje, agendado_por: email || null },
    FATURADO: { faturado: true, faturado_em: new Date().toISOString(), faturado_por: email || null },
    ENTREGUE: { entregue: true, entregue_em: data || hoje, entregue_por: email || null },
    DESFAZER_AGENDADO: { agendado_para: null, agendado_por: null },
    DESFAZER_FATURADO: { faturado: false, faturado_em: null, faturado_por: null },
    DESFAZER_ENTREGUE: { entregue: false, entregue_em: null, entregue_por: null },
  }[acao]);

  async function marcarSelecionados(acao, data) {
    if (!marcados.size) return;
    await atualizar([...marcados], camposEtapa(acao, data));
    setMarcados(new Set());
  }

  async function marcarLote() {
    const nums = lerNumeros(textoLote);
    if (!nums.length) return setMsg({ tipo: "erro", txt: "Cole os números dos pedidos." });
    const { data, error } = await sb().from("agendamentos").select("id,pedido").in("pedido", nums);
    if (error) return setMsg({ tipo: "erro", txt: error.message });
    const achados = data || [];
    const faltam = nums.filter((n) => !achados.some((a) => a.pedido === n));
    if (achados.length) {
      const r = await sb().from("agendamentos").update(camposEtapa(acaoLote, dataLote)).in("id", achados.map((a) => a.id));
      if (r.error) return setMsg({ tipo: "erro", txt: r.error.message });
    }
    setMsg({
      tipo: faltam.length ? "aviso" : "ok",
      txt: `${achados.length} pedido(s) marcado(s) como ${ETAPAS[acaoLote].rot.toUpperCase()}.${faltam.length ? ` Não encontrados no site: ${faltam.join(", ")}` : ""}`,
    });
    setTextoLote(""); setAbrirLote(false);
    carregar();
  }

  async function excluirSelecionados() {
    if (!marcados.size || !confirm(`Excluir ${marcados.size} pedido(s) dos agendamentos?`)) return;
    const { error } = await sb().from("agendamentos").delete().in("id", [...marcados]);
    if (error) return setMsg({ tipo: "erro", txt: error.message });
    setMarcados(new Set());
    carregar();
  }

  // ---------- números ----------
  const b = busca.trim().toUpperCase();
  const base = lista.filter((a) => !b || [a.cliente, a.pedido, a.instrucoes, a.nota_fiscal, a.cod_rota].some((x) => String(x || "").toUpperCase().includes(b)));
  const porEtapa = base.filter((a) => !filtroEtapa || etapa(a) === filtroEtapa);
  const visiveis = f.aplicar(porEtapa);
  const [refTabela, ajustarColunas] = useColunas("agendamentos", `${carregando}-${visiveis.length}`);

  // funil: quem chegou pelo menos até a etapa
  const chegou = (ord) => base.filter((a) => ETAPAS[etapa(a)].ordem >= ord);
  const funil = [
    { k: "MONTADO", rot: "Montados", lista: base },
    { k: "AGENDADO", rot: "Agendados", lista: chegou(1) },
    { k: "FATURADO", rot: "Faturados", lista: chegou(2) },
    { k: "ENTREGUE", rot: "Entregues", lista: chegou(3) },
  ].map((x) => ({ ...x, qtd: x.lista.length, valor: x.lista.reduce((s, a) => s + (Number(a.valor) || 0), 0) }));
  const pct = (n) => (base.length ? Math.round((n / base.length) * 100) : 0);
  const clientes = new Set(base.map((a) => a.cliente)).size;

  const todosMarcados = visiveis.length > 0 && visiveis.every((a) => marcados.has(a.id));
  function alternarTodos() {
    const n = new Set(marcados);
    visiveis.forEach((a) => (todosMarcados ? n.delete(a.id) : n.add(a.id)));
    setMarcados(n);
  }
  const periodo = (dias) => { setPendentesTodos(false); setAte(hoje); setDe(somarDias(hoje, -(dias - 1))); };

  return (
    <>
      <div className="cabecalho-pagina">
        <div className="acoes">
          <label className="campo-data">Montados de<input type="date" value={de} onChange={(e) => { setPendentesTodos(false); setDe(e.target.value); }} /></label>
          <label className="campo-data">até<input type="date" value={ate} onChange={(e) => { setPendentesTodos(false); setAte(e.target.value); }} /></label>
          <button className="btn mini" onClick={() => periodo(1)}>Hoje</button>
          <button className="btn mini" onClick={() => periodo(7)}>7 dias</button>
          <button className="btn mini" onClick={() => periodo(30)}>30 dias</button>
          <label className="check"><input type="checkbox" checked={pendentesTodos} onChange={(e) => setPendentesTodos(e.target.checked)} /> todos ainda não entregues (qualquer dia)</label>
        </div>
        <div className="acoes">
          <button className="btn" onClick={() => { setAbrirLote(!abrirLote); setAbrirColar(false); }}>Marcar por nº de pedido</button>
          <button className="btn primario" onClick={() => { setAbrirColar(!abrirColar); setAbrirLote(false); }}>{abrirColar ? "Fechar" : "Colar do RoadNet"}</button>
        </div>
      </div>

      {semTabela && <div className="alerta aviso">Rode o arquivo <b>15_agendamentos.sql</b> no Supabase (SQL Editor › Run) para ativar os Agendamentos.</div>}
      {msg && <div className={`alerta ${msg.tipo}`} onClick={() => setMsg(null)}>{msg.txt}</div>}

      {abrirColar && (
        <section className="cartao ag-colar">
          <p className="sub">No RoadNet, selecione os pedidos de agendamento montados, <b>Ctrl+C</b> e cole aqui <b>com o cabeçalho</b>. Pedido que já estiver no site não é duplicado: só atualiza os dados e mantém a etapa.</p>
          <textarea className="colar" rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ID da rota	FILIAL	Estado da Ordem	Cliente	…" />
          <div className="linha-acoes">
            <label className="campo-data">Montados em<input type="date" value={dataMontagem} onChange={(e) => setDataMontagem(e.target.value)} /></label>
            {previa && (previa.erro
              ? <span className="t-vermelho">{previa.erro}</span>
              : <span><b>{previa.pedidos.length}</b> pedido(s) · {new Set(previa.pedidos.map((p) => p.cliente)).size} cliente(s) · {moeda(previa.pedidos.reduce((s, p) => s + (p.valor || 0), 0))} · {num(previa.pedidos.reduce((s, p) => s + (p.peso || 0), 0))} kg</span>)}
            <button className="btn primario" disabled={!previa?.pedidos.length || salvando} onClick={importar}>{salvando ? "Salvando…" : "Salvar pedidos"}</button>
          </div>
        </section>
      )}

      {abrirLote && (
        <section className="cartao ag-colar">
          <p className="sub">Cole os números dos pedidos (um por linha, ou separados por vírgula/espaço) — por exemplo, a lista de faturados do Winthor.</p>
          <textarea className="colar" rows={4} value={textoLote} onChange={(e) => setTextoLote(e.target.value)} placeholder="8977002309&#10;5907001019&#10;…" />
          <div className="linha-acoes">
            <select className="campo" value={acaoLote} onChange={(e) => setAcaoLote(e.target.value)}>
              <option value="AGENDADO">Marcar como AGENDADO</option>
              <option value="FATURADO">Marcar como FATURADO</option>
              <option value="ENTREGUE">Marcar como ENTREGUE</option>
            </select>
            {acaoLote !== "FATURADO" && <label className="campo-data">{acaoLote === "AGENDADO" ? "para" : "em"}<input type="date" value={dataLote} onChange={(e) => setDataLote(e.target.value)} /></label>}
            <span className="sub">{lerNumeros(textoLote).length} número(s)</span>
            <button className="btn primario" disabled={!lerNumeros(textoLote).length} onClick={marcarLote}>Marcar</button>
          </div>
        </section>
      )}

      <section className="ag-funil">
        {funil.map((x, i) => (
          <button key={x.k} className={`ag-etapa ${ETAPAS[x.k].classe} ${filtroEtapa === x.k ? "sel" : ""}`}
            title={i ? `${pct(x.qtd)}% dos montados chegaram até aqui` : "Pedidos montados no período"}
            onClick={() => setFiltroEtapa(filtroEtapa === x.k ? "" : x.k)}>
            <span>{x.rot}</span>
            <b>{x.qtd}{i > 0 && <small> {pct(x.qtd)}%</small>}</b>
            <em>{moeda(x.valor)}</em>
            {i > 0 && <i style={{ width: `${pct(x.qtd)}%` }} />}
          </button>
        ))}
        <div className="ag-etapa ag-falta">
          <span>Falta</span>
          <b>{base.length - chegou(1).length} <small>agendar</small></b>
          <em>{chegou(1).length - chegou(2).length} faturar · {chegou(2).length - chegou(3).length} entregar</em>
        </div>
      </section>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="linha-acoes">
            <input className="campo" placeholder="Buscar cliente, pedido, NF…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
            {filtroEtapa && <button className="btn link" onClick={() => setFiltroEtapa("")}>✕ só {ETAPAS[filtroEtapa].rot.toLowerCase()} (mostrar todos)</button>}
            {f.ativos > 0 && <button className="btn link" onClick={f.limparTudo}>✕ limpar filtros</button>}
            {marcados.size > 0 && (
              <span className="ag-lote">
                <b>{marcados.size} selecionado(s):</b>
                <input type="date" className="campo ag-data" value={dataSel} onChange={(e) => setDataSel(e.target.value)} title="Data para agendar / entregar" />
                <button className="btn mini" onClick={() => marcarSelecionados("AGENDADO", dataSel)}>Agendado p/ essa data</button>
                <button className="btn mini" onClick={() => marcarSelecionados("FATURADO")}>Faturado</button>
                <button className="btn mini" onClick={() => marcarSelecionados("ENTREGUE", dataSel)}>Entregue nessa data</button>
                <button className="btn mini perigo" onClick={excluirSelecionados}>Excluir</button>
              </span>
            )}
          </div>
          <div className="linha-acoes">
            <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
            <span className="sub">{visiveis.length} pedido(s) · {clientes} cliente(s)</span>
          </div>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : !base.length ? (
          <div className="vazio">Nenhum agendamento {pendentesTodos ? "pendente" : `montado ${de === ate ? `em ${fmtData(de)}` : `entre ${fmtData(de)} e ${fmtData(ate)}`}`}. Clique em <b>Colar do RoadNet</b>.</div>
        ) : (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela="agendamentos" className="ag">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={todosMarcados} onChange={alternarTodos} /></th>
                  <ThFiltro f={f} col="etapa" linhas={porEtapa}>Etapa</ThFiltro>
                  <ThFiltro f={f} col="montado" linhas={porEtapa}>Montado</ThFiltro>
                  <ThFiltro f={f} col="cliente" linhas={porEtapa}>Cliente</ThFiltro>
                  <ThFiltro f={f} col="pedido" linhas={porEtapa}>Pedido</ThFiltro>
                  <ThFiltro f={f} col="instrucoes" linhas={porEtapa}>Instruções</ThFiltro>
                  <ThFiltro f={f} col="valor" linhas={porEtapa} className="n">Valor</ThFiltro>
                  <ThFiltro f={f} col="peso" linhas={porEtapa} className="n">KG</ThFiltro>
                  <ThFiltro f={f} col="saida" linhas={porEtapa}>Saída</ThFiltro>
                  <ThFiltro f={f} col="agendado" linhas={porEtapa}>Agendado para</ThFiltro>
                  <th className="c">Faturado</th>
                  <ThFiltro f={f} col="nf" linhas={porEtapa}>NF</ThFiltro>
                  <th className="c">Entregue</th>
                  <th>Obs</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((a) => {
                  const et = ETAPAS[etapa(a)];
                  return (
                    <tr key={a.id} className={`ag-l-${etapa(a).toLowerCase()}`}>
                      <td className="c"><input type="checkbox" checked={marcados.has(a.id)} onChange={() => { const n = new Set(marcados); n.has(a.id) ? n.delete(a.id) : n.add(a.id); setMarcados(n); }} /></td>
                      <td><span className={`ag-chip ${et.classe}`}>{et.rot}</span></td>
                      <td className="c-data">{fmtData(a.montado_em).slice(0, 5)}</td>
                      <td className="ag-cli" title={a.cliente}>{a.cliente}</td>
                      <td className="ag-ped">{a.pedido}</td>
                      <td className="ag-instr" title={a.instrucoes}>{a.instrucoes}</td>
                      <td className="n">{moeda(a.valor)}</td>
                      <td className="n">{num(a.peso)}</td>
                      <td title={a.sessao}>{a.data_saida ? fmtData(a.data_saida).slice(0, 5) : "—"}</td>
                      <td>
                        <input type="date" className="campo-ed ag-data" value={a.agendado_para || ""}
                          onChange={(e) => atualizar([a.id], e.target.value ? { agendado_para: e.target.value, agendado_por: email || null } : camposEtapa("DESFAZER_AGENDADO"))} />
                      </td>
                      <td className="c" title={a.faturado_em ? `por ${a.faturado_por || "?"}` : ""}>
                        <input type="checkbox" checked={a.faturado} onChange={(e) => atualizar([a.id], camposEtapa(e.target.checked ? "FATURADO" : "DESFAZER_FATURADO"))} />
                      </td>
                      <td><CampoEditavel valor={a.nota_fiscal} largura="7em" placeholder="nº NF" aoSalvar={(v) => atualizar([a.id], v ? { nota_fiscal: v, ...(a.faturado ? {} : camposEtapa("FATURADO")) } : { nota_fiscal: "" })} /></td>
                      <td className="c ag-ent">
                        <input type="checkbox" checked={a.entregue} onChange={(e) => atualizar([a.id], camposEtapa(e.target.checked ? "ENTREGUE" : "DESFAZER_ENTREGUE"))} />
                        {a.entregue && <small className="ag-ent-data" title={`Entregue em ${fmtData(a.entregue_em)}${a.entregue_por ? ` · marcado por ${a.entregue_por}` : ""}`}>{fmtData(a.entregue_em).slice(0, 5)}</small>}
                      </td>
                      <td><CampoEditavel valor={a.obs} largura="10em" placeholder="obs" aoSalvar={(v) => atualizar([a.id], { obs: v })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
