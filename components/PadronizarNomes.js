"use client";

import { useMemo, useState } from "react";
import { sb } from "../lib/supabase";
import { planejar, aplicar } from "../lib/padronizar";

// Prévia da padronização: mostra tudo o que vai mudar e só grava depois de "Aplicar".
// - Juntar / padronizar (marcado): mesma pessoa escrita de vários jeitos -> nome completo (do Winthor/RoadNet quando houver)
// - Parecidos (desmarcado): provável erro de digitação — conferir antes de marcar
// - Inativar (marcado): só o primeiro nome e há várias pessoas possíveis (ex.: JOSE)
export default function PadronizarNomes({ pessoas, cadastro, usos, temColunas, aoFechar, aoConcluir }) {
  const plano = useMemo(() => planejar(pessoas, cadastro, usos), [pessoas, cadastro, usos]);
  const certos = plano.acoes.filter((a) => !a.parecido);
  const parecidos = plano.acoes.filter((a) => a.parecido);
  const [escolhidas, setEscolhidas] = useState(() => new Set([...certos.map((a) => a.chave), ...plano.inativar.map((x) => `i:${x.id}`)]));
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState("");

  const alternar = (k) => setEscolhidas((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const todos = (lista, chave, marcar) => setEscolhidas((s) => { const n = new Set(s); lista.forEach((x) => (marcar ? n.add(chave(x)) : n.delete(chave(x)))); return n; });
  const marcadasAcoes = plano.acoes.filter((a) => escolhidas.has(a.chave));
  const saem = marcadasAcoes.reduce((s, a) => s + a.ids.length - 1, 0);
  const qtdInativar = plano.inativar.filter((x) => escolhidas.has(`i:${x.id}`)).length;

  async function confirmar() {
    if (!marcadasAcoes.length && !qtdInativar) return aoFechar();
    if (!confirm(`Aplicar a padronização?\n\n• ${marcadasAcoes.length} nome(s) padronizado(s), ${saem} repetido(s) removido(s)\n• ${qtdInativar} inativado(s)\n\nO que já foi gravado no frete, retorno e histórico não muda.`)) return;
    setGravando(true); setErro("");
    try {
      const r = await aplicar(sb(), plano, escolhidas, temColunas);
      aoConcluir(`Padronização feita: ${r.feitos} nome(s) padronizado(s), ${saem} repetido(s) removido(s), ${r.inativados} inativado(s).`);
    } catch (e) {
      setErro(e.message || String(e));
      setGravando(false);
    }
  }

  const Linha = ({ a }) => (
    <label className={`pad-linha ${escolhidas.has(a.chave) ? "" : "off"}`}>
      <input type="checkbox" checked={escolhidas.has(a.chave)} onChange={() => alternar(a.chave)} />
      <span className="pad-de">{a.de.filter((n) => n !== a.alvo).map((n) => <s key={n}>{n}</s>)}</span>
      <span className="pad-seta">→</span>
      <b className="pad-para">{a.alvo}</b>
      {a.oficial && <span className="pad-tag ok" title="Nome do Winthor / RoadNet">cadastro</span>}
      {a.vinculo === "DIARISTA" && <span className="pad-tag dg">DG</span>}
      {a.primeiroNome && !a.parecido && <span className="pad-tag pn" title="Tinha só o primeiro nome — confira">1º nome</span>}
      {a.usos > 0 && <small className="sub">{a.usos}× no frete</small>}
    </label>
  );

  return (
    <div className="modal-fundo nao-imprimir" onMouseDown={(e) => { if (e.target === e.currentTarget && !gravando) aoFechar(); }}>
      <div className="modal modal-pad">
        <h3>Padronizar nomes</h3>
        <p className="modal-sub">
          {pessoas.length} nomes hoje → cerca de <b>{pessoas.length - saem}</b> depois ({saem} repetidos saem, {qtdInativar} ficam inativos).
          Os nomes completos vêm do Winthor / RoadNet. Desmarque o que não quiser mudar.
        </p>

        <div className="pad-corpo">
          <div className="pad-secao">
            <div className="pad-tit">
              <b>Juntar repetidos e completar o nome ({certos.length})</b>
              <span><button className="btn link" onClick={() => todos(certos, (a) => a.chave, true)}>marcar todos</button> · <button className="btn link" onClick={() => todos(certos, (a) => a.chave, false)}>desmarcar</button></span>
            </div>
            {certos.map((a) => <Linha key={a.chave} a={a} />)}
          </div>

          {parecidos.length > 0 && (
            <div className="pad-secao aviso">
              <div className="pad-tit">
                <b>Nomes parecidos — confira antes de marcar ({parecidos.length})</b>
                <span className="sub">provável erro de digitação, mas pode ser outra pessoa (ex.: JARDEL × JARDEU)</span>
              </div>
              {parecidos.map((a) => <Linha key={a.chave} a={a} />)}
            </div>
          )}

          {plano.inativar.length > 0 && (
            <div className="pad-secao">
              <div className="pad-tit">
                <b>Só o primeiro nome e não dá para saber quem é — inativar ({plano.inativar.length})</b>
                <span className="sub">saem da lista do Frete; os nomes completos continuam</span>
              </div>
              {plano.inativar.map((x) => (
                <label key={x.id} className={`pad-linha ${escolhidas.has(`i:${x.id}`) ? "" : "off"}`} title={`Pode ser: ${x.opcoes.join(" · ")}`}>
                  <input type="checkbox" checked={escolhidas.has(`i:${x.id}`)} onChange={() => alternar(`i:${x.id}`)} />
                  <b>{x.nome}</b><small className="sub">pode ser: {x.opcoes.join(" · ")}</small>
                </label>
              ))}
            </div>
          )}

          {plano.duvidas.length > 0 && (
            <div className="pad-secao">
              <div className="pad-tit"><b>Ficam como estão — mais de uma pessoa possível ({plano.duvidas.length})</b></div>
              {plano.duvidas.map((x) => (
                <div key={x.id} className="pad-linha"><b>{x.nome}</b><small className="sub">pode ser: {x.opcoes.join(" · ")} — escolha na coluna "Cadastro oficial"</small></div>
              ))}
            </div>
          )}
        </div>

        {erro && <div className="alerta erro">{erro}</div>}
        <div className="modal-acoes">
          <button className="btn" onClick={aoFechar} disabled={gravando}>Cancelar</button>
          <button className="btn primario" onClick={confirmar} disabled={gravando}>
            {gravando ? "Aplicando…" : `Aplicar (${marcadasAcoes.length + qtdInativar})`}
          </button>
        </div>
      </div>
    </div>
  );
}
