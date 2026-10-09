"use client";

import { fmtDataHora } from "../lib/util";

// Sinal discreto de placa trocada no frete: mostra a placa que veio da programação
export default function MarcaTroca({ linha }) {
  if (!linha?.placa_original || linha.placa_original === linha.placa) return null;
  const quem = linha.placa_trocada_por ? ` por ${linha.placa_trocada_por}` : "";
  const quando = linha.placa_trocada_em ? ` em ${fmtDataHora(linha.placa_trocada_em)}` : "";
  return (
    <span className="marca-troca nao-imprimir" title={`Placa trocada${quem}${quando}. Na programação era ${linha.placa_original}.`}>
      ⇄ {linha.placa_original}
    </span>
  );
}
