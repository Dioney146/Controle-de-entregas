"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { sb } from "../../lib/supabase";
import { useDataDaUrl, useNomes, useTempoReal } from "../../lib/hooks";
import CampoEditavel from "../../components/CampoEditavel";
import { fmtData, horaInput, horaParaTimestamp, num, moeda, normPlaca } from "../../lib/util";

const ROTULO = { PROGRAMADO: "A sair", EM_ROTA: "Saiu", RETORNOU: "Retornou" };

export default function Frete() {
  const [data, setData] = useDataDaUrl();
  const [linhas, setLinhas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novaPlaca, setNovaPlaca] = useState("");
  const nomes = useNomes();

  async function carregar() {
    if (!data) return;
    const { data: s } = await sb().from("saidas").select("*").eq("data", data).order("ordem").order("id");
    setLinhas(s || []);
    setCarregando(false);
  }
  useEffect(() => { setCarregando(true); carregar(); }, [data]);
  useEffect(() => { sb().from("veiculos").select("*").order("placa").then(({ data }) => setVeiculos(data || [])); }, []);
  useTempoReal(carregar, [data]);

  async function atualizar(id, campos) {
    const antes = linhas.find((l) => l.id === id);
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...campos } : l)));
    const { error } = await sb().from("saidas").update(campos).eq("id", id);
    if (error) {
      setLinhas((ls) => ls.map((l) => (l.id === id ? antes : l)));
      throw error;
    }
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

  async function remover(l) {
    if (!confirm(`Remover ${l.placa} do frete?`)) return;
    const { error } = await sb().from("saidas").delete().eq("id", l.id);
    if (error) return alert(error.message);
    setLinhas((ls) => ls.filter((x) => x.id !== l.id));
  }

  async function adicionar() {
    const placa = normPlaca(novaPlaca);
    if (!placa) return;
    const v = veiculos.find((x) => x.placa === placa) || {};
    const { data: nova, error } = await sb().from("saidas").insert({
      data, placa, transportadora: v.transportadora || "", tipo: v.tipo || "",
      motorista: v.motorista || "", entregador: v.entregador || "", status: "PROGRAMADO",
      ordem: linhas.length ? Math.max(...linhas.map((l) => l.ordem || 0)) + 1 : 0,
    }).select().single();
    if (error) return alert(error.message);
    setLinhas((ls) => [...ls, nova]);
    setNovaPlaca("");
  }

  if (!data) return <div className="carregando">Carregando…</div>;

  const aSair = linhas.filter((l) => l.status === "PROGRAMADO").length;
  const semMotorista = linhas.filter((l) => !l.motorista).length;
  const totKg = linhas.reduce((s, l) => s + (Number(l.kg) || 0), 0);
  const totEnt = linhas.reduce((s, l) => s + (Number(l.entregas) || 0), 0);
  const totValor = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);

  return (
    <>
      <div className="cabecalho-pagina nao-imprimir">
        <div>
          <h1>Frete / Saídas</h1>
          <p className="sub">Gerado automaticamente pela programação. Complete motorista e entregador, imprima para a portaria e registre o horário de saída.</p>
        </div>
        <div className="acoes">
          <label className="campo-data">Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
          <button className="btn primario" onClick={() => window.print()} disabled={!linhas.length}>Imprimir frete</button>
        </div>
      </div>

      <section className="kpis nao-imprimir">
        <div className="kpi"><span>Veículos</span><b>{linhas.length}</b></div>
        <div className="kpi laranja"><span>A sair</span><b>{aSair}</b></div>
        <div className="kpi verde"><span>Saíram</span><b>{linhas.length - aSair}</b></div>
        <div className={`kpi ${semMotorista ? "vermelho" : ""}`}><span>Sem motorista</span><b>{semMotorista}</b></div>
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
            <table className="frete">
              <thead>
                <tr>
                  <th>Data</th><th>Zona</th><th>Placa</th><th>Trans</th><th className="n">Ent.</th><th className="n">KG</th>
                  <th>Motorista</th><th>Entregadores</th><th>Infor</th><th className="n">Valor</th><th>Saída</th>
                  <th className="nao-imprimir">Status</th><th className="nao-imprimir"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className={l.status === "PROGRAMADO" ? "" : "l-verde"}>
                    <td>{fmtData(l.data).slice(0, 5)}</td>
                    <td><CampoEditavel valor={l.zona} largura="6em" aoSalvar={(v) => atualizar(l.id, { zona: v })} /></td>
                    <td className="placa">{l.placa}</td>
                    <td>{l.transportadora}</td>
                    <td className="n"><CampoEditavel tipo="number" min={0} valor={l.entregas ?? ""} largura="4em" className="n" aoSalvar={(v) => atualizar(l.id, { entregas: v })} /></td>
                    <td className="n">{num(l.kg)}</td>
                    <td><CampoEditavel valor={l.motorista} largura="14em" lista="lista-motoristas" placeholder="motorista…" className={l.motorista ? "" : "falta"} aoSalvar={(v) => atualizar(l.id, { motorista: v })} /></td>
                    <td><CampoEditavel valor={l.entregador} largura="14em" lista="lista-entregadores" placeholder="entregador…" aoSalvar={(v) => atualizar(l.id, { entregador: v })} /></td>
                    <td><CampoEditavel valor={l.destino} largura="12em" aoSalvar={(v) => atualizar(l.id, { destino: v })} /></td>
                    <td className="n">{moeda(l.valor)}</td>
                    <td className="saida"><div className="saida-box">
                      <input type="time" className="campo-ed hora nao-imprimir" value={horaInput(l.hora_saida)} onChange={(e) => definirSaida(l, e.target.value)} />
                      <span className="so-imprimir">{horaInput(l.hora_saida)}</span>
                      {l.status === "PROGRAMADO" && <button className="btn mini nao-imprimir" onClick={() => saiuAgora(l)}>Saiu</button>}
                    </div></td>
                    <td className="nao-imprimir"><span className={`status s-${l.status}`}>{ROTULO[l.status]}</span></td>
                    <td className="nao-imprimir">{l.status === "PROGRAMADO" && <button className="btn link perigo" title="Remover do frete" onClick={() => remover(l)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>TOTAL · {linhas.length} veículos</td>
                  <td className="n">{num(totEnt)}</td><td className="n">{num(totKg)}</td>
                  <td colSpan={3}></td><td className="n">{moeda(totValor)}</td><td></td>
                  <td className="nao-imprimir" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="barra-tabela nao-imprimir">
          <div className="linha-acoes">
            <input list="lista-placas" className="campo" placeholder="Adicionar placa ao frete…" value={novaPlaca} onChange={(e) => setNovaPlaca(e.target.value.toUpperCase())} />
            <button className="btn" onClick={adicionar} disabled={!novaPlaca}>Adicionar</button>
          </div>
          {linhas.length > 0 && <Link className="btn" href={`/retorno?data=${data}`}>Ir para o Retorno →</Link>}
        </div>
      </section>

      <datalist id="lista-motoristas">{nomes.motoristas.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="lista-entregadores">{nomes.entregadores.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="lista-placas">{veiculos.map((v) => <option key={v.placa} value={v.placa}>{v.transportadora} · {v.tipo}</option>)}</datalist>
    </>
  );
}
