// Backlog: leitura do relatório de LIBERADOS do Winthor (colado ou arquivo .xls/.xlsx)
// e cálculo de dias na carteira (desde a DATA de liberação).
import { lerNumeroBR } from "./util";

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const txt = (v) => String(v ?? "").trim();

// data em qualquer formato: "21/10/2026", "21/10/2026 00:00:00", Date do Excel, número serial do Excel
export function lerData(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  if (typeof v === "number" && v > 20000 && v < 80000) { // serial do Excel
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = txt(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const numero = (v) => (typeof v === "number" ? v : lerNumeroBR(v));

// colunas do relatório (pelo nome do cabeçalho)
const MAPA = {
  numped: ["NUMPED", "PEDIDO", "NUMERO DO PEDIDO"],
  codcli: ["CODCLI"],
  cliente: ["NOMECLIENTE", "CLIENTE"],
  numnota: ["NUMNOTA"],
  filial: ["CODFILIAL", "FILIAL"],
  posicao: ["POSICAO"],
  data: ["DATA", "DTLIBERA", "DATA LIBERACAO"],
  hora: ["HORA"],
  minuto: ["MINUTO"],
  dt_entrega: ["DTENTREGA"],
  rca: ["NOMERCA"],
  supervisor: ["NOMESUP"],
  peso: ["PESOBRUTOTOT", "PESO"],
  valor: ["VLTOTAL", "VALOR"],
  cidade: ["CIDADE"],
  praca: ["PRACA"],
  carregamento: ["NUMCARREGAMENTO"],
  destino: ["DESTINO"],
  placa: ["PLACA"],
};

// texto colado -> matriz (linhas x colunas)
export const textoParaMatriz = (t) => String(t || "").replace(/\r/g, "").split("\n").filter((l) => l.trim()).map((l) => l.split("\t"));

// matriz -> { pedidos, ignoradas, erro }
export function lerLiberados(matriz) {
  const iCab = matriz.findIndex((r) => r.some((c) => sem(c) === "NUMPED"));
  if (iCab < 0) return { pedidos: [], ignoradas: 0, erro: "Não achei a coluna NUMPED. Cole/envie o relatório de liberados do Winthor com o cabeçalho." };
  const cab = matriz[iCab].map(sem);
  const idx = Object.fromEntries(Object.entries(MAPA).map(([k, nomes]) => [k, cab.findIndex((c) => nomes.includes(c))]));
  if (idx.posicao < 0) return { pedidos: [], ignoradas: 0, erro: "Não achei a coluna POSICAO (L / M) no relatório." };
  const pedidos = new Map();
  let ignoradas = 0;
  for (const r of matriz.slice(iCab + 1)) {
    const v = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
    const numped = txt(v("numped")).replace(/\.0+$/, "").replace(/\D/g, "");
    const posicao = sem(v("posicao")).slice(0, 1);
    // linha de total / rodapé / em branco: sem número de pedido ou sem posição
    if (!numped || numped.length < 4 || !posicao) { ignoradas++; continue; }
    const hora = txt(v("hora")), minuto = txt(v("minuto"));
    pedidos.set(numped, {
      numped,
      codcli: txt(v("codcli")).replace(/\.0+$/, ""),
      cliente: txt(v("cliente")).toUpperCase(),
      numnota: txt(v("numnota")).replace(/\.0+$/, "").replace(/^0$/, ""),
      filial: txt(v("filial")),
      posicao,
      data_liberacao: lerData(v("data")),
      hora_liberacao: hora ? `${hora.padStart(2, "0")}:${(minuto || "0").padStart(2, "0")}` : "",
      dt_entrega: lerData(v("dt_entrega")),
      rca: txt(v("rca")).toUpperCase(),
      supervisor: txt(v("supervisor")).toUpperCase(),
      peso: numero(v("peso")),
      valor: numero(v("valor")),
      cidade: txt(v("cidade")).toUpperCase(),
      praca: txt(v("praca")).toUpperCase(),
      carregamento: txt(v("carregamento")).replace(/\.0+$/, "").replace(/^0$/, ""),
      destino: txt(v("destino")).toUpperCase(),
      placa: txt(v("placa")).toUpperCase(),
    });
  }
  const lista = [...pedidos.values()];
  return { pedidos: lista, ignoradas, erro: lista.length ? "" : "Nenhum pedido encontrado no relatório." };
}

// dias na carteira: da DATA de liberação até hoje (ou até o dia em que saiu)
const diaMs = 86400000;
const meiaNoite = (iso) => Date.parse(`${iso}T12:00:00Z`);
export function diasNaCarteira(p, hojeIso) {
  if (!p.data_liberacao) return null;
  const fim = p.saiu_em ? new Date(p.saiu_em).toLocaleDateString("sv-SE", { timeZone: "America/Manaus" }) : hojeIso;
  return Math.max(0, Math.round((meiaNoite(fim) - meiaNoite(p.data_liberacao)) / diaMs));
}

// faixas de idade da carteira
export const FAIXAS = [
  { k: "0", rot: "Hoje", min: 0, max: 0, cor: "#22a35a" },
  { k: "1", rot: "1 dia", min: 1, max: 1, cor: "#84cc16" },
  { k: "2", rot: "2 dias", min: 2, max: 2, cor: "#f59e0b" },
  { k: "3", rot: "3 dias", min: 3, max: 3, cor: "#f97316" },
  { k: "4-6", rot: "4 a 6 dias", min: 4, max: 6, cor: "#ef4444" },
  { k: "7+", rot: "7 dias ou mais", min: 7, max: Infinity, cor: "#991b1b" },
];
export const faixaDe = (d) => (d == null ? null : FAIXAS.find((f) => d >= f.min && d <= f.max));
