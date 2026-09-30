// Leitura dos dados colados (ou exportados) do RoadNet.
// Aceita: texto copiado da grade (separado por TAB), com ou sem cabeçalho,
// ou linhas vindas de um arquivo Excel/CSV (array de arrays).

import { normPlaca } from "./util";

// Ordem padrão das colunas (igual à aba "BASE DA PROGRAMAÇÃO"), usada quando não há cabeçalho
const ORDEM_PADRAO = [
  "ID", "Cor", "Descrição", "Número de paradas", "Número de Ordens", "Entrega Total Peso",
  "Entrega Total Valor", "Capacidade Peso", "Equipamento", "Trabalhadores", "Distância total",
  "Carregar Peso (gráfico)", "Designado para a rota", "Horário Alterado", "Criado Por",
  "Horário Criado", "Modificado Por", "Dispositivo Móvel", "Tipos de equipamento",
  "Sessão de roteirização", "Estado",
];

const semAcento = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// campo do banco -> possíveis nomes de coluna no RoadNet
const MAPA = {
  rota_id: ["id", "rota", "route id"],
  descricao: ["descricao", "description"],
  paradas: ["numero de paradas", "paradas", "stops"],
  ordens: ["numero de ordens", "ordens", "orders"],
  peso: ["entrega total peso", "peso", "delivery total weight"],
  valor: ["entrega total valor", "valor", "delivery total value"],
  capacidade: ["capacidade peso", "capacidade", "weight capacity"],
  placa: ["equipamento", "equipment"],
  trabalhadores: ["trabalhadores", "workers"],
  distancia: ["distancia total", "distancia", "total distance"],
  tipo_equip: ["tipos de equipamento", "tipo de equipamento", "equipment types"],
  sessao: ["sessao de roteirizacao", "sessao", "routing session"],
  estado: ["estado", "status"],
};

function detectarCabecalho(linha) {
  const nomes = linha.map(semAcento);
  if (!nomes.includes("equipamento") && !nomes.includes("equipment")) return null;
  const idx = {};
  for (const [campo, opcoes] of Object.entries(MAPA)) {
    const i = nomes.findIndex((n) => opcoes.includes(n));
    if (i >= 0) idx[campo] = i;
  }
  return idx;
}

function indicePadrao() {
  return detectarCabecalho(ORDEM_PADRAO);
}

// Converte "1.062,049" / "1062.049" / 1062.049 em número
function paraNumero(v, formatoBR) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/[R$\s%]/g, "");
  if (!s || s === "-") return null;
  if (formatoBR) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export function textoParaLinhas(texto) {
  return String(texto || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t"));
}

// Tenta achar a data de saída na "Sessão de roteirização": "25/08/2026 - ROTEIRIZAÇÃO AM ..."
export function dataDaSessao(sessao) {
  const m = String(sessao || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function interpretar(linhas) {
  if (!linhas.length) return { rotas: [], avisos: ["Nada foi colado."], dataSugerida: null };

  let idx = null;
  let inicio = 0;
  for (let i = 0; i < Math.min(linhas.length, 5); i++) {
    const h = detectarCabecalho(linhas[i].map((c) => (c === null || c === undefined ? "" : String(c))));
    if (h) { idx = h; inicio = i + 1; break; }
  }
  const avisos = [];
  if (!idx) {
    idx = indicePadrao();
    avisos.push("Cabeçalho não encontrado: usei a ordem padrão de colunas do RoadNet.");
  }
  if (idx.placa === undefined) return { rotas: [], avisos: ["Coluna 'Equipamento' não encontrada."], dataSugerida: null };

  const dados = linhas.slice(inicio);

  // Se algum número tem vírgula, o texto está no formato brasileiro (ponto = milhar)
  const colsNum = ["paradas", "ordens", "peso", "valor", "capacidade", "distancia"].map((c) => idx[c]).filter((i) => i !== undefined);
  const formatoBR = dados.some((l) => colsNum.some((i) => typeof l[i] === "string" && /\d,\d/.test(l[i])));

  const pega = (l, campo) => (idx[campo] === undefined ? null : l[idx[campo]]);
  const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());

  const rotas = [];
  for (const l of dados) {
    const placa = normPlaca(pega(l, "placa"));
    if (!placa) continue;
    rotas.push({
      rota_id: txt(pega(l, "rota_id")),
      descricao: txt(pega(l, "descricao")),
      paradas: paraNumero(pega(l, "paradas"), formatoBR),
      ordens: paraNumero(pega(l, "ordens"), formatoBR),
      peso: paraNumero(pega(l, "peso"), formatoBR),
      valor: paraNumero(pega(l, "valor"), formatoBR),
      capacidade: paraNumero(pega(l, "capacidade"), formatoBR),
      placa,
      trabalhadores: txt(pega(l, "trabalhadores")),
      distancia: paraNumero(pega(l, "distancia"), formatoBR),
      tipo_equip: txt(pega(l, "tipo_equip")),
      sessao: txt(pega(l, "sessao")),
      estado: txt(pega(l, "estado")),
    });
  }
  for (const r of rotas) {
    if (r.paradas !== null) r.paradas = Math.round(r.paradas);
    if (r.ordens !== null) r.ordens = Math.round(r.ordens);
  }

  const cont = {};
  rotas.forEach((r) => (cont[r.placa] = (cont[r.placa] || 0) + 1));
  const dup = Object.keys(cont).filter((p) => cont[p] > 1);
  if (dup.length) avisos.push(`Placas com mais de uma rota: ${dup.join(", ")}`);

  const dataSugerida = rotas.map((r) => dataDaSessao(r.sessao)).find(Boolean) || null;
  return { rotas, avisos, dataSugerida };
}
