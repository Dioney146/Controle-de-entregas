// Agendamentos: leitura do que é colado do RoadNet (pedidos da rota de agendamento)
// e a etapa de cada pedido: MONTADO -> AGENDADO -> FATURADO -> ENTREGUE.
import { lerNumeroBR } from "./util";

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const dataISO = (s) => {
  const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// colunas do RoadNet -> campos do site (pelo nome do cabeçalho, sem acento)
const MAPA = [
  ["pedido", ["NUMERO DO PEDIDO", "PEDIDO", "NUMPED"]],
  ["cliente", ["CLIENTE"]],
  ["cod_rota", ["CODROTA"]],
  ["rota_id", ["ID DA ROTA"]],
  ["descricao_rota", ["DESCRICAO DA ROTA"]],
  ["instrucoes", ["INSTRUCOES ESPECIAIS"]],
  ["valor", ["ENTREGA VALOR"]],
  ["peso", ["ENTREGA PESO"]],
  ["volume", ["ENTREGA VOLUME"]],
  ["itens", ["ITENS DO PEDIDO"]],
  ["estado_ordem", ["ESTADO DA ORDEM"]],
  ["cidade", ["CIDADE"]],
  ["municipio", ["MUNICIPIO", "BAIRRO"]],
  ["filial", ["FILIAL"]],
  ["sessao", ["SESSAO DE ROTEIRIZACAO"]],
  ["data_termino", ["DATA DE TERMINO"]],
  ["gerenciado_por", ["GERENCIADO POR"]],
  ["classe", ["CLASSE DA ORDEM"]],
];
const NUMEROS = new Set(["valor", "peso", "volume"]);

// texto colado (com cabeçalho) -> { pedidos: [...], erro }
export function lerColagem(texto) {
  const linhas = String(texto || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!linhas.length) return { pedidos: [], erro: "Cole os pedidos do RoadNet (com o cabeçalho)." };
  const cab = linhas[0].split("\t").map(sem);
  const idx = {};
  for (const [campo, nomes] of MAPA) idx[campo] = cab.findIndex((c) => nomes.includes(c));
  if (idx.pedido < 0) return { pedidos: [], erro: "Não achei a coluna \"Número do pedido\". Copie do RoadNet junto com o cabeçalho." };
  const vistos = new Set();
  const pedidos = [];
  for (const l of linhas.slice(1)) {
    const c = l.split("\t");
    const val = (campo) => (idx[campo] >= 0 ? String(c[idx[campo]] ?? "").trim() : "");
    const pedido = val("pedido").replace(/\D/g, "");
    if (!pedido || vistos.has(pedido)) continue;
    vistos.add(pedido);
    const p = { pedido };
    for (const [campo] of MAPA) {
      if (campo === "pedido") continue;
      const v = val(campo);
      if (NUMEROS.has(campo)) p[campo] = lerNumeroBR(v);
      else if (campo === "itens") p[campo] = v ? Math.round(lerNumeroBR(v) || 0) : null;
      else if (campo === "data_termino") p[campo] = dataISO(v);
      else p[campo] = v.replace(/\s{2,}/g, " ");
    }
    p.data_saida = dataISO(p.sessao); // "23/10/2026 - ROTEIRIZAÇÃO AM ..." -> saída 23/10
    pedidos.push(p);
  }
  return { pedidos, erro: pedidos.length ? "" : "Nenhum pedido encontrado no texto colado." };
}

// números de pedido colados em qualquer formato (um por linha, separados por vírgula, espaço...)
export const lerNumeros = (texto) => [...new Set(String(texto || "").match(/\d{6,}/g) || [])];

export const ETAPAS = {
  MONTADO: { rot: "Montado", classe: "et-montado", ordem: 0 },
  AGENDADO: { rot: "Agendado", classe: "et-agendado", ordem: 1 },
  FATURADO: { rot: "Faturado", classe: "et-faturado", ordem: 2 },
  ENTREGUE: { rot: "Entregue", classe: "et-entregue", ordem: 3 },
};
export function etapa(a) {
  if (a.entregue) return "ENTREGUE";
  if (a.faturado) return "FATURADO";
  if (a.agendado_para) return "AGENDADO";
  return "MONTADO";
}
