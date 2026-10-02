"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const MOTIVOS = ["SEM MOTORISTA", "SEM ENTREGADOR", "NÃO EMBARCADO", "NÃO CONFERIDO"];

// Janela que pede o motivo antes de excluir um veículo do frete.
// Uso: <MotivoExclusao linha={l} aoConfirmar={(motivo) => ...} aoCancelar={() => ...} />
export default function MotivoExclusao({ linha, aoConfirmar, aoCancelar }) {
  const [escolha, setEscolha] = useState("");
  const [outro, setOutro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const campoOutro = useRef(null);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") aoCancelar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aoCancelar]);

  useEffect(() => { if (escolha === "OUTRO") campoOutro.current?.focus(); }, [escolha]);

  const motivo = escolha === "OUTRO" ? (outro.trim() ? `OUTRO: ${outro.trim().toUpperCase()}` : "") : escolha;

  async function confirmar(e) {
    e.preventDefault();
    if (!motivo || enviando) return;
    setEnviando(true);
    try { await aoConfirmar(motivo); } finally { setEnviando(false); }
  }

  return createPortal(
    <div className="modal-fundo nao-imprimir" onMouseDown={(e) => { if (e.target === e.currentTarget) aoCancelar(); }}>
      <form className="modal" onSubmit={confirmar}>
        <h3>Excluir {linha.placa} do frete</h3>
        <p className="modal-sub">{[linha.transportadora, linha.destino].filter(Boolean).join(" · ")}</p>
        <p className="modal-pergunta">Qual o motivo da exclusão?</p>
        <div className="motivos">
          {MOTIVOS.map((m) => (
            <label key={m} className={`motivo ${escolha === m ? "sel" : ""}`}>
              <input type="radio" name="motivo" value={m} checked={escolha === m} onChange={() => setEscolha(m)} />
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </label>
          ))}
          <label className={`motivo ${escolha === "OUTRO" ? "sel" : ""}`}>
            <input type="radio" name="motivo" value="OUTRO" checked={escolha === "OUTRO"} onChange={() => setEscolha("OUTRO")} />
            Outro:
            <input
              ref={campoOutro}
              className="campo motivo-outro"
              placeholder="descreva o motivo"
              value={outro}
              onFocus={() => setEscolha("OUTRO")}
              onChange={(e) => setOutro(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-acoes">
          <button type="button" className="btn" onClick={aoCancelar}>Cancelar</button>
          <button type="submit" className="btn perigo-cheio" disabled={!motivo || enviando}>
            {enviando ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
