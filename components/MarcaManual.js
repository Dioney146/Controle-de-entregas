"use client";

import { fmtDataHora } from "../lib/util";

// Sinal discreto para veículo adicionado à mão no frete (fora do "Gerar frete" da Programação)
export default function MarcaManual({ linha }) {
  if (!linha?.manual) return null;
  const quem = linha.adicionado_por ? ` por ${linha.adicionado_por}` : "";
  const quando = linha.created_at ? ` em ${fmtDataHora(linha.created_at)}` : "";
  return (
    <span className="marca-manual nao-imprimir" title={`Adicionado manualmente${quem}${quando} (não veio da programação)`}>
      M
    </span>
  );
}
