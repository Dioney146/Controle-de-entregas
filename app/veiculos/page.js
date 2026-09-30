"use client";

import { useEffect, useMemo, useState } from "react";
import { sb } from "../../lib/supabase";
import CampoEditavel from "../../components/CampoEditavel";
import { normPlaca } from "../../lib/util";

const TIPOS = ["VAN", "FIORINO", "HR", "3/4", "TOCO", "TRUCK", "CARRETA", "CAVALO"];
const VAZIO = { placa: "", transportadora: "", tipo: "", motorista: "", entregador: "", ativo: true, obs: "" };

export default function Veiculos() {
  const [lista, setLista] = useState([]);
  const [novo, setNovo] = useState(VAZIO);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const { data } = await sb().from("veiculos").select("*").order("transportadora").order("placa");
    setLista(data || []);
    setCarregando(false);
  }
  useEffect(() => {
    carregar();
    const p = new URLSearchParams(window.location.search).get("nova");
    if (p) setNovo({ ...VAZIO, placa: normPlaca(p) });
  }, []);

  async function atualizar(placa, campos) {
    const { error } = await sb().from("veiculos").update(campos).eq("placa", placa);
    if (error) throw error;
    setLista((ls) => ls.map((v) => (v.placa === placa ? { ...v, ...campos } : v)));
  }

  async function adicionar(e) {
    e.preventDefault();
    const reg = { ...novo, placa: normPlaca(novo.placa), transportadora: novo.transportadora.toUpperCase().trim(),
      motorista: novo.motorista.toUpperCase().trim(), entregador: novo.entregador.toUpperCase().trim(), tipo: novo.tipo.toUpperCase().trim() };
    if (!reg.placa) return;
    const { error } = await sb().from("veiculos").insert(reg);
    if (error) return alert(error.code === "23505" ? "Essa placa já está cadastrada." : error.message);
    setNovo(VAZIO);
    carregar();
  }

  async function excluir(v) {
    if (!confirm(`Excluir o veículo ${v.placa}? (o histórico dele continua salvo)`)) return;
    const { error } = await sb().from("veiculos").delete().eq("placa", v.placa);
    if (error) return alert(error.message);
    setLista((ls) => ls.filter((x) => x.placa !== v.placa));
  }

  const transportadoras = useMemo(() => [...new Set(lista.map((v) => v.transportadora).filter(Boolean))].sort(), [lista]);
  const b = busca.trim().toUpperCase();
  const visiveis = lista.filter((v) => !b || [v.placa, v.transportadora, v.motorista, v.tipo].some((x) => (x || "").toUpperCase().includes(b)));
  const ativos = lista.filter((v) => v.ativo).length;

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Veículos</h1>
          <p className="sub">
            Não precisa mais marcar STATUS todo dia: quem tem carga no RoadNet entra no frete sozinho.
            Marque <b>Frota fixa</b> só nos veículos que você quer ver em <b className="t-laranja">laranja</b> quando ficarem sem carga.
          </p>
        </div>
      </div>

      <form className="cartao form-linha" onSubmit={adicionar}>
        <input className="campo" placeholder="Placa" value={novo.placa} onChange={(e) => setNovo({ ...novo, placa: e.target.value.toUpperCase() })} required style={{ width: "8em" }} />
        <input className="campo" list="lista-trans" placeholder="Transportadora" value={novo.transportadora} onChange={(e) => setNovo({ ...novo, transportadora: e.target.value })} />
        <input className="campo" list="lista-tipos" placeholder="Tipo" value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })} style={{ width: "7em" }} />
        <input className="campo" placeholder="Motorista fixo (opcional)" value={novo.motorista} onChange={(e) => setNovo({ ...novo, motorista: e.target.value })} />
        <input className="campo" placeholder="Entregador fixo (opcional)" value={novo.entregador} onChange={(e) => setNovo({ ...novo, entregador: e.target.value })} />
        <label className="check"><input type="checkbox" checked={novo.ativo} onChange={(e) => setNovo({ ...novo, ativo: e.target.checked })} /> Frota fixa</label>
        <button className="btn primario">Cadastrar</button>
      </form>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <input className="campo" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <span className="sub">{lista.length} veículos · {ativos} na frota fixa</span>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Transportadora</th><th>Placa</th><th>Tipo</th><th>Motorista fixo</th><th>Entregador fixo</th><th>Frota fixa</th><th>Obs</th><th></th></tr></thead>
              <tbody>
                {visiveis.map((v) => (
                  <tr key={v.placa}>
                    <td><CampoEditavel valor={v.transportadora} lista="lista-trans" aoSalvar={(x) => atualizar(v.placa, { transportadora: x })} /></td>
                    <td className="placa">{v.placa}</td>
                    <td><CampoEditavel valor={v.tipo} lista="lista-tipos" largura="6em" aoSalvar={(x) => atualizar(v.placa, { tipo: x })} /></td>
                    <td><CampoEditavel valor={v.motorista} aoSalvar={(x) => atualizar(v.placa, { motorista: x })} /></td>
                    <td><CampoEditavel valor={v.entregador} aoSalvar={(x) => atualizar(v.placa, { entregador: x })} /></td>
                    <td className="c"><input type="checkbox" checked={v.ativo} onChange={(e) => atualizar(v.placa, { ativo: e.target.checked }).catch((er) => alert(er.message))} /></td>
                    <td><CampoEditavel valor={v.obs} aoSalvar={(x) => atualizar(v.placa, { obs: x })} /></td>
                    <td><button className="btn link perigo" onClick={() => excluir(v)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <datalist id="lista-trans">{transportadoras.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="lista-tipos">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );
}
