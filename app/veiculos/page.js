"use client";

import { useEffect, useMemo, useState } from "react";
import { sb } from "../../lib/supabase";
import CampoEditavel from "../../components/CampoEditavel";
import { useTempoReal } from "../../lib/hooks";
import { useColunas } from "../../lib/colunas";
import { normPlaca, corTrans } from "../../lib/util";

// Cadastro de veículos: transportadora, placa, tipo, ANTT (RNTRC), RENAVAM e situação no GreenMile.
// Organizado por transportadora (HOK primeiro), com filtros e o que está faltando em cada placa.

const TIPOS = ["VAN", "FIORINO", "HR", "3/4", "TOCO", "TRUCK", "CARRETA", "CAVALO"];
const GM = {
  CADASTRADO: { rot: "Cadastrado", classe: "gm-ok" },
  PENDENTE: { rot: "Pendente", classe: "gm-aviso" },
  NAO_CADASTRADO: { rot: "Não cadastrado", classe: "gm-pend" },
};
const VAZIO = { placa: "", transportadora: "", tipo: "", antt: "", renavam: "", gm_status: "PENDENTE" };
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
// RENAVAM tem 11 dígitos (os antigos, 9); ANTT/RNTRC tem 8 ou 9
const renavamOk = (r) => !r || /^\d{9}$|^\d{11}$/.test(r);
const anttOk = (a) => !a || /^\d{8,9}$/.test(a);
const ordemTrans = (t) => (String(t).toUpperCase().startsWith("HOK") ? "0" : "1") + (t || "zzz");

export default function Veiculos() {
  const [lista, setLista] = useState([]);
  const [novo, setNovo] = useState(VAZIO);
  const [busca, setBusca] = useState("");
  const [filtroTrans, setFiltroTrans] = useState("");
  const [filtroGM, setFiltroGM] = useState("");
  const [soFaltando, setSoFaltando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [abrirNovo, setAbrirNovo] = useState(false);

  async function carregar() {
    const { data } = await sb().from("veiculos").select("*").order("transportadora").order("placa");
    setLista(data || []);
    setCarregando(false);
  }
  useEffect(() => {
    carregar();
    const p = new URLSearchParams(window.location.search).get("nova");
    if (p) { setNovo({ ...VAZIO, placa: normPlaca(p) }); setAbrirNovo(true); }
  }, []);
  useTempoReal(carregar, []);

  const temColunas = !lista.length || "gm_status" in lista[0];
  const avisoSql = "Rode o arquivo 14_veiculos_antt_renavam_gm.sql no Supabase para ativar ANTT, RENAVAM e GreenMile.";

  async function atualizar(placa, campos) {
    const { error } = await sb().from("veiculos").update(campos).eq("placa", placa);
    if (error) throw new Error(/antt|renavam|gm_status/i.test(error.message || "") ? avisoSql : error.message);
    setLista((ls) => ls.map((v) => (v.placa === placa ? { ...v, ...campos } : v)));
  }

  async function adicionar(e) {
    e.preventDefault();
    const reg = {
      placa: normPlaca(novo.placa), transportadora: novo.transportadora.toUpperCase().trim(), tipo: novo.tipo.toUpperCase().trim(),
      ...(temColunas ? { antt: soDigitos(novo.antt), renavam: soDigitos(novo.renavam), gm_status: novo.gm_status } : {}),
    };
    if (!reg.placa) return;
    if (temColunas && !renavamOk(reg.renavam)) return alert("RENAVAM deve ter 11 dígitos (ou 9, nos documentos antigos).");
    if (temColunas && !anttOk(reg.antt)) return alert("ANTT (RNTRC) deve ter 8 ou 9 dígitos.");
    const { error } = await sb().from("veiculos").insert(reg);
    if (error) return alert(error.code === "23505" ? "Essa placa já está cadastrada." : error.message);
    setNovo(VAZIO);
    setAbrirNovo(false);
    carregar();
  }

  async function excluir(v) {
    if (!confirm(`Excluir o veículo ${v.placa}? (o histórico dele continua salvo)`)) return;
    const { error } = await sb().from("veiculos").delete().eq("placa", v.placa);
    if (error) return alert(error.message);
    setLista((ls) => ls.filter((x) => x.placa !== v.placa));
  }

  const faltando = (v) => [!v.tipo && "tipo", temColunas && !v.antt && "ANTT", temColunas && !v.renavam && "RENAVAM", temColunas && v.gm_status !== "CADASTRADO" && "GreenMile"].filter(Boolean);

  // resumo por transportadora
  const porTrans = useMemo(() => {
    const m = new Map();
    for (const v of lista) {
      const t = (v.transportadora || "SEM TRANSPORTADORA").toUpperCase();
      const g = m.get(t) || { t, qtd: 0, gm: 0 };
      g.qtd++; if (v.gm_status === "CADASTRADO") g.gm++;
      m.set(t, g);
    }
    return [...m.values()].sort((a, b) => ordemTrans(a.t).localeCompare(ordemTrans(b.t)));
  }, [lista]);

  const b = busca.trim().toUpperCase();
  const visiveis = lista.filter((v) =>
    (!b || [v.placa, v.transportadora, v.tipo, v.antt, v.renavam].some((x) => String(x || "").toUpperCase().includes(b))) &&
    (!filtroTrans || (v.transportadora || "SEM TRANSPORTADORA").toUpperCase() === filtroTrans) &&
    (!filtroGM || v.gm_status === filtroGM) &&
    (!soFaltando || faltando(v).length > 0));
  // agrupado por transportadora (HOK primeiro), placas em ordem
  const grupos = useMemo(() => {
    const m = new Map();
    for (const v of visiveis) {
      const t = (v.transportadora || "SEM TRANSPORTADORA").toUpperCase();
      if (!m.has(t)) m.set(t, []);
      m.get(t).push(v);
    }
    return [...m.entries()].sort((a, b) => ordemTrans(a[0]).localeCompare(ordemTrans(b[0])))
      .map(([t, vs]) => [t, vs.sort((x, y) => x.placa.localeCompare(y.placa))]);
  }, [visiveis]);

  const transportadoras = porTrans.map((g) => g.t).filter((t) => t !== "SEM TRANSPORTADORA");
  const [refTabela, ajustarColunas] = useColunas("veiculos2", `${carregando}-${visiveis.length}`);
  const total = lista.length;
  const qtd = (f) => lista.filter(f).length;

  return (
    <>
      {!temColunas && <div className="alerta aviso">{avisoSql}</div>}

      <section className="kpis">
        <div className="kpi"><span>Veículos</span><b>{total}</b></div>
        <div className="kpi verde"><span>GreenMile cadastrados</span><b>{qtd((v) => v.gm_status === "CADASTRADO")} / {total}</b></div>
        <div className="kpi laranja"><span>GreenMile pendentes</span><b>{qtd((v) => temColunas && v.gm_status !== "CADASTRADO")}</b></div>
        <div className="kpi"><span>Sem ANTT</span><b>{temColunas ? qtd((v) => !v.antt) : "—"}</b></div>
        <div className="kpi"><span>Sem RENAVAM</span><b>{temColunas ? qtd((v) => !v.renavam) : "—"}</b></div>
      </section>

      <div className="veic-trans">
        <button className={`chip-trans todos ${!filtroTrans ? "sel" : ""}`} onClick={() => setFiltroTrans("")}>TODAS <b>{total}</b></button>
        {porTrans.map((g) => (
          <button key={g.t} className={`chip-trans ${corTrans(g.t)} ${filtroTrans === g.t ? "sel" : ""}`}
            title={`${g.t}: ${g.qtd} veículo(s) · ${g.gm} no GreenMile`} onClick={() => setFiltroTrans(filtroTrans === g.t ? "" : g.t)}>
            {g.t} <b>{g.qtd}</b>
          </button>
        ))}
      </div>

      {abrirNovo && (
        <form className="cartao form-linha veic-novo" onSubmit={adicionar}>
          <b>Novo veículo:</b>
          <input className="campo" placeholder="Placa" value={novo.placa} onChange={(e) => setNovo({ ...novo, placa: e.target.value.toUpperCase() })} required style={{ width: "8em" }} autoFocus />
          <input className="campo" list="lista-trans" placeholder="Transportadora" value={novo.transportadora} onChange={(e) => setNovo({ ...novo, transportadora: e.target.value })} />
          <input className="campo" list="lista-tipos" placeholder="Tipo" value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })} style={{ width: "7em" }} />
          <input className="campo" inputMode="numeric" placeholder="ANTT (RNTRC)" value={novo.antt} onChange={(e) => setNovo({ ...novo, antt: soDigitos(e.target.value) })} style={{ width: "9em" }} disabled={!temColunas} />
          <input className="campo" inputMode="numeric" placeholder="RENAVAM" value={novo.renavam} onChange={(e) => setNovo({ ...novo, renavam: soDigitos(e.target.value) })} style={{ width: "10em" }} disabled={!temColunas} />
          <select className="campo" value={novo.gm_status} onChange={(e) => setNovo({ ...novo, gm_status: e.target.value })} disabled={!temColunas}>
            {Object.entries(GM).map(([k, g]) => <option key={k} value={k}>GreenMile: {g.rot}</option>)}
          </select>
          <button className="btn primario">Cadastrar</button>
          <button type="button" className="btn link" onClick={() => setAbrirNovo(false)}>cancelar</button>
        </form>
      )}

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <div className="linha-acoes">
            <input className="campo" placeholder="Buscar placa, ANTT, RENAVAM…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
            <select className="campo" value={filtroGM} onChange={(e) => setFiltroGM(e.target.value)} disabled={!temColunas}>
              <option value="">GreenMile: todos</option>
              {Object.entries(GM).map(([k, g]) => <option key={k} value={k}>GreenMile: {g.rot}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={soFaltando} onChange={(e) => setSoFaltando(e.target.checked)} /> só com algo faltando</label>
            {(busca || filtroTrans || filtroGM || soFaltando) && (
              <button className="btn link" onClick={() => { setBusca(""); setFiltroTrans(""); setFiltroGM(""); setSoFaltando(false); }}>✕ limpar filtros</button>
            )}
          </div>
          <div className="linha-acoes">
            <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
            <span className="sub">{visiveis.length} de {total} veículo(s)</span>
            {!abrirNovo && <button className="btn primario" onClick={() => setAbrirNovo(true)}>+ Novo veículo</button>}
          </div>
        </div>

        {carregando ? <div className="carregando">Carregando…</div> : !visiveis.length ? (
          <div className="vazio">Nenhum veículo com esse filtro.</div>
        ) : (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela="veiculos2" className="veic">
              <thead>
                <tr><th>Transportadora</th><th>Placa</th><th>Tipo</th><th>ANTT (RNTRC)</th><th>RENAVAM</th><th>GreenMile</th><th></th></tr>
              </thead>
              {grupos.map(([t, vs]) => (
                <tbody key={t}>
                  <tr className="veic-grupo">
                    <td colSpan={7}>
                      <span className={`veic-grupo-nome ${corTrans(t)}`}>{t}</span>
                      <span className="sub"> {vs.length} veículo(s) · {vs.filter((v) => v.gm_status === "CADASTRADO").length} no GreenMile</span>
                    </td>
                  </tr>
                  {vs.map((v) => {
                    const falta = faltando(v);
                    return (
                      <tr key={v.placa} data-id={v.placa} title={falta.length ? `Falta: ${falta.join(", ")}` : "Cadastro completo"}>
                        <td className={corTrans(v.transportadora)}><CampoEditavel valor={v.transportadora} lista="lista-trans" aoSalvar={(x) => atualizar(v.placa, { transportadora: x })} /></td>
                        <td className="placa">{v.placa}</td>
                        <td><CampoEditavel valor={v.tipo} lista="lista-tipos" largura="6em" placeholder="tipo" aoSalvar={(x) => atualizar(v.placa, { tipo: x })} /></td>
                        <td className={v.antt && !anttOk(v.antt) ? "veic-invalido" : ""}>
                          <CampoEditavel valor={v.antt || ""} largura="9em" placeholder="—" aoSalvar={(x) => {
                            const d = soDigitos(x);
                            if (!anttOk(d)) { alert("ANTT (RNTRC) deve ter 8 ou 9 dígitos."); return false; }
                            return atualizar(v.placa, { antt: d });
                          }} />
                        </td>
                        <td className={v.renavam && !renavamOk(v.renavam) ? "veic-invalido" : ""}>
                          <CampoEditavel valor={v.renavam || ""} largura="10em" placeholder="—" aoSalvar={(x) => {
                            const d = soDigitos(x);
                            if (!renavamOk(d)) { alert("RENAVAM deve ter 11 dígitos (ou 9, nos documentos antigos)."); return false; }
                            return atualizar(v.placa, { renavam: d });
                          }} />
                        </td>
                        <td>
                          <select className={`campo-ed gm-sel ${GM[v.gm_status]?.classe || ""}`} value={v.gm_status || "PENDENTE"} disabled={!temColunas}
                            onChange={(e) => atualizar(v.placa, { gm_status: e.target.value }).catch((er) => alert(er.message))}>
                            {Object.entries(GM).map(([k, g]) => <option key={k} value={k}>{g.rot}</option>)}
                          </select>
                        </td>
                        <td className="c"><button className="btn link perigo" title="Excluir veículo" onClick={() => excluir(v)}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
      <datalist id="lista-trans">{transportadoras.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="lista-tipos">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );
}
