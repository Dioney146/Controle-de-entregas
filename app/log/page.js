"use client";

import { useEffect, useMemo, useState } from "react";
import { sb } from "../../lib/supabase";
import { useColunas } from "../../lib/colunas";
import { useTempoReal } from "../../lib/hooks";
import { useFiltros, ThFiltro } from "../../components/FiltroColuna";
import { fmtDataHora, baixarCSV } from "../../lib/util";

// Log de alterações: quem mudou o quê, quando, de/para (gravado pelo próprio banco)

const TELA = { saidas: "Frete / Retorno", veiculos: "Veículos", pessoas: "Motoristas", programacao: "Programação" };
const CAMPO = {
  motorista: "Motorista", entregador: "Entregadores", hora_saida: "Saída", status: "Status",
  cancelados: "Cancelados", reentregas: "Reentregas", pendentes: "Pendentes", celular_devolvido: "Celular devolvido",
  checkout_em: "Checkout", checkout_por: "Checkout por", arquivado: "Enviado ao histórico", zona: "Zona",
  entregas: "Entregas", destino: "Infor", obs: "Obs", kg: "KG", valor: "Valor", transportadora: "Transportadora",
  tipo: "Tipo", nome: "Nome", funcao: "Função", ativo: "Ativo", ordem: "Ordem", data: "Data", placa: "Placa",
  registros: "Registros", motivo: "Motivo da exclusão",
};
const STATUS = { PROGRAMADO: "A sair", EM_ROTA: "Saiu", RETORNOU: "Retornou" };
const ESCONDER = new Set(["arquivado_em", "arquivado_por", "ordem"]); // detalhes repetidos

function valor(campo, v) {
  if (v === null || v === undefined || v === "") return "";
  if (v === "true") return "SIM";
  if (v === "false") return "NÃO";
  if (campo === "status") return STATUS[v] || v;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return fmtDataHora(v);
  return v;
}

const ACAO = { ALTEROU: "Alterou", INCLUIU: "Incluiu", EXCLUIU: "Excluiu", IMPORTOU: "Importou" };

const COLUNAS = {
  quando: { valor: (l) => l.quando?.slice(0, 10), rotulo: (v) => v.split("-").reverse().join("/") },
  usuario: { valor: (l) => l.usuario },
  tela: { valor: (l) => TELA[l.tabela] || l.tabela },
  acao: { valor: (l) => ACAO[l.acao] || l.acao },
  ref: { valor: (l) => l.referencia },
  campo: { valor: (l) => CAMPO[l.campo] || l.campo },
};

export default function Log() {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(500);
  const f = useFiltros(COLUNAS);

  async function carregar() {
    try {
      // as 5.000 alterações mais recentes
      let d = [];
      for (let de = 0; de < 5000; de += 1000) {
        const { data, error } = await sb().from("log_alteracoes").select("*").order("id", { ascending: false }).range(de, de + 999);
        if (error) throw error;
        d = d.concat(data || []);
        if (!data || data.length < 1000) break;
      }
      setLinhas(d.filter((l) => !ESCONDER.has(l.campo)));
    } catch (e) { alert("Não foi possível ler o log. Rodou o arquivo 06_log_alteracoes.sql no Supabase?\n\n" + e.message); }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useTempoReal(carregar, []);

  // tempo real: novas alterações aparecem sozinhas
  useEffect(() => {
    let t;
    const canal = sb().channel("log-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "log_alteracoes" }, () => { clearTimeout(t); t = setTimeout(carregar, 500); })
      .subscribe();
    return () => { clearTimeout(t); sb().removeChannel(canal); };
  }, []);

  const base = useMemo(() => {
    const b = busca.trim().toUpperCase();
    return linhas.filter((l) => !b || [l.usuario, l.referencia, l.antes, l.depois, CAMPO[l.campo] || l.campo]
      .some((x) => String(x || "").toUpperCase().includes(b)));
  }, [linhas, busca]);
  const visiveis = f.aplicar(base);
  const [refTabela, ajustarColunas] = useColunas("log", `${carregando}-${Math.min(visiveis.length, limite)}`);

  function exportar() {
    baixarCSV("log_alteracoes.csv", ["QUANDO", "USUARIO", "TELA", "ACAO", "REFERENCIA", "CAMPO", "ANTES", "DEPOIS"],
      visiveis.map((l) => [fmtDataHora(l.quando), l.usuario, TELA[l.tabela] || l.tabela, ACAO[l.acao] || l.acao,
        l.referencia, CAMPO[l.campo] || l.campo, valor(l.campo, l.antes), valor(l.campo, l.depois)]));
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <div className="linha-acoes">
          <input className="campo" placeholder="Pesquisar usuário, placa, nome, valor…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 320 }} />
          {(f.ativos > 0 || busca) && <button className="btn link" onClick={() => { f.limparTudo(); setBusca(""); }}>✕ limpar filtros</button>}
        </div>
        <div className="acoes">
          <button className="btn" onClick={exportar} disabled={!visiveis.length}>Exportar Excel (CSV)</button>
        </div>
      </div>

      <section className="cartao sem-pad">
        <div className="barra-tabela">
          <span className="sub">{visiveis.length} alteração(ões) · atualiza sozinho</span>
          <button className="btn link" onClick={ajustarColunas}>↔ ajustar colunas</button>
        </div>
        {carregando ? <div className="carregando">Carregando…</div> : linhas.length === 0 ? (
          <div className="vazio">Nenhuma alteração registrada ainda.</div>
        ) : (
          <div className="tabela-rolagem">
            <table ref={refTabela} data-tabela="log">
              <thead>
                <tr>
                  <ThFiltro f={f} col="quando" linhas={base}>Quando</ThFiltro>
                  <ThFiltro f={f} col="usuario" linhas={base}>Usuário</ThFiltro>
                  <ThFiltro f={f} col="tela" linhas={base}>Tela</ThFiltro>
                  <ThFiltro f={f} col="acao" linhas={base}>Ação</ThFiltro>
                  <ThFiltro f={f} col="ref" linhas={base}>Referência</ThFiltro>
                  <ThFiltro f={f} col="campo" linhas={base}>Campo</ThFiltro>
                  <th>Antes</th>
                  <th>Depois</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.slice(0, limite).map((l) => (
                  <tr key={l.id} data-id={l.id} data-ref={l.referencia} className={`log-${l.acao}`}>
                    <td>{fmtDataHora(l.quando)}</td>
                    <td>{l.usuario}</td>
                    <td>{TELA[l.tabela] || l.tabela}</td>
                    <td><span className={`status log-acao-${l.acao}`}>{ACAO[l.acao] || l.acao}</span></td>
                    <td className="placa">{l.referencia}</td>
                    <td>{CAMPO[l.campo] || l.campo}</td>
                    <td className="log-antes">{valor(l.campo, l.antes)}</td>
                    <td className="log-depois">{valor(l.campo, l.depois)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visiveis.length > limite && (
              <div className="vazio"><button className="btn" onClick={() => setLimite(limite + 1000)}>Mostrar mais ({visiveis.length - limite} restantes)</button></div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
