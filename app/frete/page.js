"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { sb } from "../../lib/supabase";
import { useDataDaUrl, useTempoReal } from "../../lib/hooks";
import CampoEditavel from "../../components/CampoEditavel";
import { useColunas } from "../../lib/colunas";
import { desfazerFrete } from "../../lib/frete";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import SeletorPessoa, { usePessoas } from "../../components/SeletorPessoa";
import MotivoExclusao from "../../components/MotivoExclusao";
import { useUsuario } from "../../components/Casca";
import { fmtData, fmtDataHora, horaInput, horaParaTimestamp, num, moeda, normPlaca, corTrans, lerNumeroBR } from "../../lib/util";
import MarcaManual from "../../components/MarcaManual";

const ROTULO = { PROGRAMADO: "A sair", EM_ROTA: "Saiu", RETORNOU: "Retornou" };

// colunas que podem ser filtradas / classificadas
const COLUNAS = {
  data: { valor: (l) => l.data },
  zona: { valor: (l) => l.zona },
  placa: { valor: (l) => l.placa },
  trans: { valor: (l) => l.transportadora },
  ent: { valor: (l) => l.entregas, numero: true },
  kg: { valor: (l) => l.kg, numero: true },
  motorista: { valor: (l) => l.motorista },
  entregador: { valor: (l) => l.entregador },
  infor: { valor: (l) => l.destino },
  valor: { valor: (l) => l.valor, numero: true },
  saida: { valor: (l) => horaInput(l.hora_saida) },
  status: { valor: (l) => (l.arquivado ? "No histórico" : ROTULO[l.status]) },
};

export default function Frete() {
  const [data, setData] = useDataDaUrl();
  const [linhas, setLinhas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novaPlaca, setNovaPlaca] = useState("");
  const [novoKg, setNovoKg] = useState("");
  const [novoValor, setNovoValor] = useState("");
  const [novasEnt, setNovasEnt] = useState("");
  const [verPendencias, setVerPendencias] = useState(false);
  const [menuImp, setMenuImp] = useState(false);
  const [excluindo, setExcluindo] = useState(null);     // linha aguardando o motivo
  const [excluidas, setExcluidas] = useState([]);       // removidas nesta data (com motivo)
  const [verExcluidas, setVerExcluidas] = useState(false);
  const pessoas = usePessoas();
  const { email } = useUsuario();
  const [refTabela, ajustarColunas] = useColunas("frete", `${carregando}-${linhas.length}`);
  const f = useFiltros(COLUNAS);
  const exibidas = f.aplicar(linhas);

  async function carregar() {
    if (!data) return;
    const [{ data: s }, ex] = await Promise.all([
      sb().from("saidas").select("*").eq("data", data).order("ordem").order("id"),
      sb().from("saidas_excluidas").select("id,placa,motivo,usuario,quando,dados").eq("data", data).order("quando", { ascending: false }),
    ]);
    setLinhas(s || []);
    setExcluidas(ex.error ? [] : ex.data || []);
    setCarregando(false);
  }
  useEffect(() => { setCarregando(true); carregar(); }, [data]);
  useEffect(() => { sb().from("veiculos").select("*").order("placa").then(({ data }) => setVeiculos(data || [])); }, []);
  useTempoReal(carregar, [data]);

  // Impressão em 1 folha: calcula altura da linha e fonte pela quantidade de veículos
  // (A4 paisagem = 210mm; tira margens, título e folga)
  useEffect(() => {
    const ajustar = () => {
      const linhasTabela = exibidas.length + 2; // + cabeçalho + total
      const alturaMm = Math.min(8, 176 / Math.max(1, linhasTabela));
      const fontePx = Math.max(6.5, Math.min(11, alturaMm * 2.1));
      document.documentElement.style.setProperty("--linha-imp", alturaMm.toFixed(2) + "mm");
      document.documentElement.style.setProperty("--fonte-imp", fontePx.toFixed(1) + "px");
    };
    ajustar();
    window.addEventListener("beforeprint", ajustar);
    return () => window.removeEventListener("beforeprint", ajustar);
  }, [exibidas.length]);

  async function atualizar(id, campos) {
    const antes = linhas.find((l) => l.id === id);
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...campos } : l)));
    const { error } = await sb().from("saidas").update(campos).eq("id", id);
    if (error) {
      setLinhas((ls) => ls.map((l) => (l.id === id ? antes : l)));
      throw error;
    }
  }

  // troca de placa: se a placa estiver no cadastro de veículos, já traz a transportadora e o tipo
  async function trocarPlaca(l, valor) {
    const placa = normPlaca(valor);
    if (!placa) throw new Error("A placa não pode ficar em branco.");
    if (placa === l.placa) return;
    const repetida = linhas.find((x) => x.id !== l.id && x.placa === placa);
    if (repetida && !confirm(`A placa ${placa} já está neste frete. Usar mesmo assim?`)) return false;
    const v = veiculos.find((x) => x.placa === placa);
    const campos = { placa };
    if (v?.transportadora) campos.transportadora = v.transportadora;
    if (v?.tipo) campos.tipo = v.tipo;
    await atualizar(l.id, campos);
  }

  async function definirSaida(l, hhmm) {
    if (l.status === "RETORNOU" && !hhmm) return alert("Esse veículo já retornou. Desfaça o checkout no Retorno antes.");
    const campos = hhmm
      ? { hora_saida: horaParaTimestamp(l.data, hhmm), status: l.status === "RETORNOU" ? "RETORNOU" : "EM_ROTA" }
      : { hora_saida: null, status: "PROGRAMADO" };
    try { await atualizar(l.id, campos); } catch (e) { alert(e.message); }
  }

  async function saiuAgora(l) {
    try { await atualizar(l.id, { hora_saida: new Date().toISOString(), status: "EM_ROTA" }); } catch (e) { alert(e.message); }
  }

  // ---------- histórico: só vai quando for enviado (tudo 100%) ----------
  const pendencias = (l) => [
    !l.motorista && "motorista",
    !l.entregador && "entregador",
    !l.hora_saida && "horário de saída",
  ].filter(Boolean);

  async function enviarHistorico() {
    const alvo = exibidas.filter((l) => !l.arquivado);
    if (!alvo.length) return;
    const faltando = alvo.filter((l) => pendencias(l).length);
    if (faltando.length) {
      setVerPendencias(true);
      alert(
        `Ainda não está 100%: ${faltando.length} veículo(s) com informação faltando.\n\n` +
        faltando.slice(0, 15).map((l) => `• ${l.placa}: falta ${pendencias(l).join(", ")}`).join("\n") +
        (faltando.length > 15 ? `\n… e mais ${faltando.length - 15}` : "") +
        `\n\nAs linhas com pendência ficaram marcadas em vermelho.`
      );
      return;
    }
    if (!confirm(`Enviar ${alvo.length} veículo(s) de ${fmtData(data)} para o HISTÓRICO?`)) return;
    const ids = alvo.map((l) => l.id);
    const campos = { arquivado: true, arquivado_em: new Date().toISOString(), arquivado_por: email || null };
    const { error } = await sb().from("saidas").update(campos).in("id", ids);
    if (error) return alert(error.message);
    setLinhas((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ...campos } : l)));
    setVerPendencias(false);
  }

  // ---------- Retorno: o frete só aparece lá quando for liberado ----------
  const liberados = linhas.filter((l) => l.liberado_retorno).length;
  const temColunaLiberado = linhas.length === 0 || "liberado_retorno" in linhas[0];

  async function liberarRetorno() {
    if (!temColunaLiberado) return alert("Rode o arquivo 10_liberar_retorno.sql no Supabase para ativar a liberação.");
    const alvo = linhas.filter((l) => !l.liberado_retorno);
    if (!alvo.length) return;
    if (!confirm(`Liberar o frete de ${fmtData(data)} (${alvo.length} veículo(s)) para o RETORNO?\nO monitoramento passa a ver esses veículos para dar checkout.`)) return;
    const ids = alvo.map((l) => l.id);
    const campos = { liberado_retorno: true, liberado_retorno_em: new Date().toISOString(), liberado_retorno_por: email || null };
    const { error } = await sb().from("saidas").update(campos).in("id", ids);
    if (error) return alert(error.message);
    setLinhas((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ...campos } : l)));
  }

  async function tirarDoRetorno() {
    const alvo = linhas.filter((l) => l.liberado_retorno);
    if (!alvo.length) return;
    const comCheckout = alvo.filter((l) => l.status === "RETORNOU").length;
    if (comCheckout && !confirm(`Atenção: ${comCheckout} veículo(s) desta data já tiveram checkout no Retorno. Tirar mesmo assim? (os checkouts não são apagados)`)) return;
    if (!comCheckout && !confirm(`Tirar o frete de ${fmtData(data)} do RETORNO? Ele só volta a aparecer lá quando for liberado de novo.`)) return;
    const ids = alvo.map((l) => l.id);
    const campos = { liberado_retorno: false, liberado_retorno_em: null, liberado_retorno_por: null };
    const { error } = await sb().from("saidas").update(campos).in("id", ids);
    if (error) return alert(error.message);
    setLinhas((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ...campos } : l)));
  }

  async function tirarDoHistorico() {
    const alvo = exibidas.filter((l) => l.arquivado);
    if (!alvo.length || !confirm(`Tirar ${alvo.length} veículo(s) de ${fmtData(data)} do HISTÓRICO para corrigir?`)) return;
    const ids = alvo.map((l) => l.id);
    const campos = { arquivado: false, arquivado_em: null, arquivado_por: null };
    const { error } = await sb().from("saidas").update(campos).in("id", ids);
    if (error) return alert(error.message);
    setLinhas((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ...campos } : l)));
  }

  async function desfazerTudo() {
    if (await desfazerFrete(data)) carregar();
  }

  async function desfazerSaida(l) {
    if (l.arquivado) return alert("Esse veículo já está no histórico. Clique em \"Tirar do histórico\" antes de corrigir.");
    if (!confirm(`Desfazer a saída de ${l.placa}? Ele volta para "A sair".`)) return;
    try { await atualizar(l.id, { hora_saida: null, status: "PROGRAMADO", checkout_em: null, checkout_por: null }); } catch (e) { alert(e.message); }
  }

  // excluir do frete: só com motivo (fica guardado e aparece no Log)
  function remover(l) {
    if (l.arquivado) return alert("Esse veículo já está no histórico. Clique em \"Tirar do histórico\" antes de excluir.");
    setExcluindo(l);
  }
  async function confirmarExclusao(motivo) {
    const l = excluindo;
    const { error } = await sb().rpc("excluir_do_frete", { p_id: l.id, p_motivo: motivo });
    if (error) {
      const semFuncao = /excluir_do_frete|function|schema cache/i.test(error.message || "");
      return alert(semFuncao
        ? "A exclusão com motivo ainda não está ativada. Rode o arquivo 09_exclusao_justificada.sql no Supabase."
        : error.message);
    }
    setLinhas((ls) => ls.filter((x) => x.id !== l.id));
    setExcluindo(null);
    carregar();
  }

  async function adicionar() {
    const placa = normPlaca(novaPlaca);
    if (!placa) return;
    if (linhas.some((l) => l.placa === placa) && !confirm(`A placa ${placa} já está neste frete. Adicionar mesmo assim?`)) return;
    const kg = lerNumeroBR(novoKg), valor = lerNumeroBR(novoValor), entregas = lerNumeroBR(novasEnt);
    if ((novoKg && kg === null) || (novoValor && valor === null) || (novasEnt && entregas === null)) return alert("Confira o peso, o valor e as entregas: algum número está inválido.");
    const v = veiculos.find((x) => x.placa === placa) || {};
    const linha = {
      data, placa, transportadora: v.transportadora || "", tipo: v.tipo || "",
      motorista: "", entregador: "", status: "PROGRAMADO",
      kg, valor, entregas: entregas === null ? null : Math.round(entregas),
      ...(linhas.some((l) => l.liberado_retorno) ? { liberado_retorno: true, liberado_retorno_em: new Date().toISOString(), liberado_retorno_por: email || null } : {}),
      ordem: linhas.length ? Math.max(...linhas.map((l) => l.ordem || 0)) + 1 : 0,
    };
    let { data: nova, error } = await sb().from("saidas").insert({ ...linha, manual: true, adicionado_por: email || null }).select().single();
    if (error && /manual|adicionado_por/i.test(error.message || "")) {
      // banco ainda sem o 11_veiculo_manual.sql: adiciona sem a marca
      ({ data: nova, error } = await sb().from("saidas").insert(linha).select().single());
    }
    if (error) return alert(error.message);
    setLinhas((ls) => [...ls, nova]);
    setNovaPlaca(""); setNovoKg(""); setNovoValor(""); setNovasEnt("");
  }

  // peso e valor podem ser digitados nos veículos manuais (ou nos que estão sem peso/valor)
  const editaPesoValor = (l) => !l.arquivado && (l.manual || l.kg === null || l.valor === null);

  // Impressão com ou sem os nomes de motorista e entregadores
  function imprimir(comNomes) {
    setMenuImp(false);
    const raiz = document.documentElement;
    raiz.classList.toggle("imp-sem-nomes", !comNomes);
    const limpar = () => { raiz.classList.remove("imp-sem-nomes"); window.removeEventListener("afterprint", limpar); };
    window.addEventListener("afterprint", limpar);
    setTimeout(() => window.print(), 50);
  }

  if (!data) return <div className="carregando">Carregando…</div>;

  const aSair = linhas.filter((l) => l.status === "PROGRAMADO").length;
  const semMotorista = linhas.filter((l) => !l.motorista).length;
  const totKg = linhas.reduce((s, l) => s + (Number(l.kg) || 0), 0);
  const totEnt = linhas.reduce((s, l) => s + (Number(l.entregas) || 0), 0);
  const totValor = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  // totais do rodapé seguem o filtro (como SUBTOTAL do Excel)
  const somaVis = (c) => exibidas.reduce((s, l) => s + (Number(l[c]) || 0), 0);

  return (
    <>
      <div className="cabecalho-pagina nao-imprimir">
        <div>
        </div>
        <div className="acoes">
          <label className="campo-data">Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <button className="btn" onClick={desfazerTudo} disabled={!linhas.length} title="Tira do frete os veículos desta data">↩ Desfazer frete</button>
          {exibidas.some((l) => l.arquivado) && (
            <button className="btn" onClick={tirarDoHistorico} title="Volta para correção">↩ Tirar do histórico</button>
          )}
          {liberados < linhas.length ? (
            <button className="btn laranja" onClick={liberarRetorno} disabled={!linhas.length} title="Só depois disso o frete aparece no Retorno (monitoramento)">
              ➜ Liberar para o Retorno{liberados > 0 ? ` (${linhas.length - liberados} faltando)` : ""}
            </button>
          ) : (
            <button className="btn" onClick={tirarDoRetorno} title="Esconde este frete do Retorno">↩ Tirar do Retorno</button>
          )}
          <button className="btn verde" onClick={enviarHistorico} disabled={!exibidas.some((l) => !l.arquivado)} title="Só envia se motorista, entregador e saída estiverem preenchidos">
            ✓ Enviar para o histórico
          </button>
          <div className="menu-imprimir" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMenuImp(false); }}>
            <button className="btn primario" onClick={() => setMenuImp((v) => !v)} disabled={!linhas.length}>Imprimir frete ▾</button>
            {menuImp && (
              <div className="menu-imprimir-lista">
                <button onClick={() => imprimir(true)}>🖨️ Com nomes <small>(motorista e entregadores)</small></button>
                <button onClick={() => imprimir(false)}>🖨️ Sem nomes <small>(colunas em branco)</small></button>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="kpis nao-imprimir">
        <div className="kpi"><span>Veículos</span><b>{linhas.length}</b></div>
        <div className="kpi laranja"><span>A sair</span><b>{aSair}</b></div>
        <div className="kpi verde"><span>Saíram</span><b>{linhas.length - aSair}</b></div>
        <div className="kpi"><span>Motorista a definir</span><b>{semMotorista}</b></div>
        <div className={`kpi ${liberados === linhas.length && linhas.length ? "verde" : "laranja"}`} title="Liberados para o Retorno (monitoramento)"><span>No Retorno</span><b>{liberados} / {linhas.length}</b></div>
        <div className="kpi verde"><span>No histórico</span><b>{linhas.filter((l) => l.arquivado).length} / {linhas.length}</b></div>
        <div className="kpi"><span>Entregas · Peso</span><b>{num(totEnt)} · {num(totKg)} kg</b></div>
      </section>

      <div className="so-imprimir titulo-impressao">
        <b>PROGRAMAÇÃO DE SAÍDA — ROTEIRIZAÇÃO AM</b>
        <span>DATA: {fmtData(data)}</span>
      </div>

      <section className="cartao sem-pad">
        {carregando ? <div className="carregando">Carregando…</div> : linhas.length === 0 ? (
          <div className="vazio">Nenhum frete para {fmtData(data)}. Vá em <Link href="/">Programação</Link> e clique em <b>Gerar frete</b>.</div>
        ) : (
          <div className="tabela-rolagem">
            <table className="frete" ref={refTabela} data-tabela="frete">
              <thead>
                <tr>
                  <ThFiltro f={f} col="data" linhas={linhas} className="col-data">Data</ThFiltro>
                  <ThFiltro f={f} col="zona" linhas={linhas} className="col-zona">Zona</ThFiltro>
                  <ThFiltro f={f} col="placa" linhas={linhas}>Placa</ThFiltro>
                  <ThFiltro f={f} col="trans" linhas={linhas}>Trans</ThFiltro>
                  <ThFiltro f={f} col="ent" linhas={linhas} className="n">Ent.</ThFiltro>
                  <ThFiltro f={f} col="kg" linhas={linhas} className="n">KG</ThFiltro>
                  <ThFiltro f={f} col="motorista" linhas={linhas} className="col-nome">Motorista</ThFiltro>
                  <ThFiltro f={f} col="entregador" linhas={linhas} className="col-nome">Entregadores</ThFiltro>
                  <ThFiltro f={f} col="infor" linhas={linhas}>Infor</ThFiltro>
                  <ThFiltro f={f} col="valor" linhas={linhas} className="n">Valor</ThFiltro>
                  <ThFiltro f={f} col="saida" linhas={linhas}>Saída</ThFiltro>
                  <ThFiltro f={f} col="status" linhas={linhas} className="nao-imprimir">Status</ThFiltro>
                  <th className="nao-imprimir"></th>
                </tr>
              </thead>
              <tbody>
                {exibidas.map((l) => (
                  <tr key={l.id} data-id={l.id} className={`${l.status === "PROGRAMADO" ? "" : "l-verde"} ${l.arquivado ? "l-arquivado" : ""} ${verPendencias && !l.arquivado && pendencias(l).length ? "l-pendente" : ""} ${l.manual ? "l-manual" : ""}`}>
                    <td className="c-data col-data">{fmtData(l.data).slice(0, 5)}</td>
                    <td className="col-zona"><CampoEditavel valor={l.zona} largura="6em" aoSalvar={(v) => atualizar(l.id, { zona: v })} /></td>
                    <td className="placa"><div className="placa-box"><CampoEditavel valor={l.placa} largura="7em" lista="lista-placas" aoSalvar={(v) => trocarPlaca(l, v)} /><MarcaManual linha={l} /></div></td>
                    <td className={corTrans(l.transportadora)}><CampoEditavel valor={l.transportadora} largura="8em" lista="lista-trans" aoSalvar={(v) => atualizar(l.id, { transportadora: v })} /></td>
                    <td className="n"><CampoEditavel tipo="number" min={0} valor={l.entregas ?? ""} largura="4em" className="n" aoSalvar={(v) => atualizar(l.id, { entregas: v })} /></td>
                    <td className="n">{editaPesoValor(l)
                      ? <CampoEditavel tipo="decimal" casas={0} valor={l.kg} largura="5em" className="n" placeholder="peso" aoSalvar={(v) => atualizar(l.id, { kg: v })} />
                      : num(l.kg)}</td>
                    <td className="col-nome"><SeletorPessoa lista={pessoas} funcao="MOTORISTA" valor={l.motorista} placeholder="motorista…" aoSalvar={(v) => atualizar(l.id, { motorista: v })} /></td>
                    <td className="col-nome"><SeletorPessoa lista={pessoas} funcao="ENTREGADOR" multiplo valor={l.entregador} placeholder="entregador…" aoSalvar={(v) => atualizar(l.id, { entregador: v })} /></td>
                    <td><CampoEditavel valor={l.destino} largura="12em" aoSalvar={(v) => atualizar(l.id, { destino: v })} /></td>
                    <td className="n">{editaPesoValor(l)
                      ? <CampoEditavel tipo="decimal" valor={l.valor} largura="7em" className="n" placeholder="valor R$" aoSalvar={(v) => atualizar(l.id, { valor: v })} />
                      : moeda(l.valor)}</td>
                    <td className="saida"><div className="saida-box">
                      <input type="time" className="campo-ed hora nao-imprimir" value={horaInput(l.hora_saida)} onChange={(e) => definirSaida(l, e.target.value)} />
                      <span className="so-imprimir">{horaInput(l.hora_saida)}</span>
                      {l.status === "PROGRAMADO" && <button className="btn mini nao-imprimir" onClick={() => saiuAgora(l)}>Saiu</button>}
                    </div></td>
                    <td className="nao-imprimir">{l.arquivado ? <span className="status s-ARQ" title={`Enviado ${l.arquivado_por ? "por " + l.arquivado_por : ""}`}>✓ Histórico</span> : <span className={`status s-${l.status}`}>{ROTULO[l.status]}</span>}</td>
                    <td className="nao-imprimir">
                      {l.status === "PROGRAMADO"
                        ? <button className="btn link perigo" title="Remover do frete" onClick={() => remover(l)}>✕</button>
                        : <button className="btn link" title="Desfazer a saída (volta para A sair)" onClick={() => desfazerSaida(l)}>↩</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="nao-imprimir">TOTAL · {exibidas.length} veículos</td>
                  <td colSpan={2}><span className="so-imprimir">TOTAL · {exibidas.length} veículos</span></td>
                  <td className="n">{num(somaVis("entregas"))}</td><td className="n">{num(somaVis("kg"))}</td>
                  <td colSpan={3}></td><td className="n">{moeda(somaVis("valor"))}</td><td></td>
                  <td className="nao-imprimir" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="barra-tabela nao-imprimir">
          <div className="linha-acoes">
            <form className="add-veiculo" onSubmit={(e) => { e.preventDefault(); adicionar(); }}>
              <input list="lista-placas" className="campo" placeholder="Adicionar placa ao frete…" value={novaPlaca} onChange={(e) => setNovaPlaca(e.target.value.toUpperCase())} />
              {novaPlaca && (
                <>
                  <input className="campo n curto" inputMode="numeric" placeholder="Entregas" value={novasEnt} onChange={(e) => setNovasEnt(e.target.value)} />
                  <input className="campo n curto" inputMode="decimal" placeholder="Peso (kg)" value={novoKg} onChange={(e) => setNovoKg(e.target.value)} />
                  <input className="campo n" inputMode="decimal" placeholder="Valor (R$)" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} />
                </>
              )}
              <button className="btn" disabled={!novaPlaca}>Adicionar</button>
            </form>
            <button className="btn link" title="Volta as colunas para o auto ajuste" onClick={ajustarColunas}>↔ ajustar colunas</button>
          </div>
          <div className="linha-acoes">
            {excluidas.length > 0 && (
              <button className="btn link" onClick={() => setVerExcluidas((v) => !v)}>
                🗑 {excluidas.length} excluído(s) {verExcluidas ? "▲" : "▼"}
              </button>
            )}
            {f.ativos > 0 && <button className="btn link" onClick={f.limparTudo}>✕ limpar filtros ({exibidas.length} de {linhas.length})</button>}
            {linhas.length > 0 && <Link className="btn" href={`/retorno?data=${data}`}>Ir para o Retorno →</Link>}
          </div>
        </div>
        {verExcluidas && excluidas.length > 0 && (
          <div className="excluidas nao-imprimir">
            <table>
              <thead><tr><th>Placa</th><th>Trans</th><th>Infor</th><th>Motivo</th><th>Excluído por</th><th>Quando</th></tr></thead>
              <tbody>
                {excluidas.map((x) => (
                  <tr key={x.id}>
                    <td className="placa">{x.placa}</td>
                    <td>{x.dados?.transportadora}</td>
                    <td>{x.dados?.destino}</td>
                    <td><b>{x.motivo}</b></td>
                    <td>{x.usuario}</td>
                    <td>{fmtDataHora(x.quando)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {excluindo && <MotivoExclusao linha={excluindo} aoConfirmar={confirmarExclusao} aoCancelar={() => setExcluindo(null)} />}

      <datalist id="lista-placas">{veiculos.map((v) => <option key={v.placa} value={v.placa}>{v.transportadora} · {v.tipo}</option>)}</datalist>
      <datalist id="lista-trans">
        {[...new Set([...veiculos, ...linhas].map((x) => (x.transportadora || "").trim().toUpperCase()).filter(Boolean))].sort().map((t) => <option key={t} value={t} />)}
      </datalist>
    </>
  );
}
