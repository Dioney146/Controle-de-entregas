// Backlog: compara os LIBERADOS (carteira do Winthor) com os MONTADOS (Winthor).
//  - pedido liberado que está nos montados       -> MONTADO (montado nesta montagem)
//  - pedido liberado com carregamento que NÃO está nos montados (ou carregamento de dia anterior)
//                                                -> BACKLOG (carregamento antigo que já devia ter sido separado)
//  - pedido liberado sem carregamento             -> NÃO MONTADO
//  - pedido montado que não está nos liberados    -> já saiu da carteira (separado / faturado)
// Dias na carteira: da DATA de liberação até a data de referência.
import { lerNumeroBR } from "./util";

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const chave = (s) => sem(s).replace(/[^A-Z0-9]/g, ""); // "Número do pedido" -> "NUMERODOPEDIDO"
const txt = (v) => String(v ?? "").trim();
const inteiro = (v) => txt(v).replace(/\.0+$/, "").replace(/\D/g, "").replace(/^0+$/, "");
const numero = (v) => (typeof v === "number" ? v : lerNumeroBR(v));

// data em qualquer formato: "21/10/2026", "21/10/2026 00:00:00", "23/10/2026 - ROTEIRIZAÇÃO…", Date, serial do Excel
export function lerData(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = txt(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// texto colado -> matriz (linhas x colunas)
export const textoParaMatriz = (t) => String(t || "").replace(/\r/g, "").split("\n").filter((l) => l.trim()).map((l) => l.split("\t"));

// acha a linha do cabeçalho e o índice de cada campo (pelos nomes possíveis da coluna)
function cabecalho(matriz, mapa, obrigatorios) {
  for (let i = 0; i < Math.min(matriz.length, 40); i++) {
    const cab = matriz[i].map(chave);
    const idx = Object.fromEntries(Object.entries(mapa).map(([k, nomes]) => [k, nomes.map(chave).map((n) => cab.indexOf(n)).find((x) => x >= 0) ?? -1]));
    if (obrigatorios.some((k) => idx[k] >= 0)) return { i, idx };
  }
  return null;
}

// ---------- LIBERADOS (LIBERADOS_AM do Winthor) ----------
const MAPA_LIB = {
  numped: ["NUMPED", "PEDIDO", "NUMERO DO PEDIDO"],
  codcli: ["CODCLI"],
  cliente: ["NOMECLIENTE", "CLIENTE"],
  posicao: ["POSICAO"],
  data: ["DATA", "DTLIBERA", "DATA LIBERACAO"],
  hora: ["HORA"],
  minuto: ["MINUTO"],
  rca: ["NOMERCA"],
  supervisor: ["NOMESUP"],
  peso: ["PESOBRUTOTOT", "PESO"],
  valor: ["VLTOTAL", "VALOR"],
  cidade: ["CIDADE"],
  praca: ["PRACA"],
  carregamento: ["NUMCARREGAMENTO", "NUMCAR", "CARREGAMENTO"],
  destino: ["DESTINO"],
  placa: ["PLACA"],
};
export function lerLiberados(matriz) {
  const c = cabecalho(matriz, MAPA_LIB, ["numped"]);
  if (!c) return { pedidos: [], ignoradas: 0, erro: "Não achei a coluna NUMPED. Cole o relatório de liberados do Winthor com o cabeçalho." };
  const pedidos = new Map();
  let ignoradas = 0;
  for (const r of matriz.slice(c.i + 1)) {
    const v = (k) => (c.idx[k] >= 0 ? r[c.idx[k]] : "");
    const numped = inteiro(v("numped"));
    if (!numped || numped.length < 4) { ignoradas++; continue; } // total / rodapé / linha em branco
    const hora = txt(v("hora")), minuto = txt(v("minuto"));
    pedidos.set(numped, {
      numped,
      codcli: inteiro(v("codcli")),
      cliente: txt(v("cliente")).toUpperCase(),
      posicao: sem(v("posicao")).slice(0, 1),
      data_liberacao: lerData(v("data")),
      hora_liberacao: hora ? `${hora.padStart(2, "0")}:${(minuto || "0").padStart(2, "0")}` : "",
      rca: txt(v("rca")).toUpperCase(),
      supervisor: txt(v("supervisor")).toUpperCase(),
      peso: numero(v("peso")) || 0,
      valor: numero(v("valor")) || 0,
      cidade: txt(v("cidade")).toUpperCase(),
      praca: txt(v("praca")).toUpperCase(),
      carregamento: inteiro(v("carregamento")),
      destino: txt(v("destino")).toUpperCase(),
      placa: txt(v("placa")).toUpperCase(),
    });
  }
  const lista = [...pedidos.values()];
  return { pedidos: lista, ignoradas, erro: lista.length ? "" : "Nenhum pedido encontrado no relatório de liberados." };
}

// ---------- MONTADOS (Winthor; aceita também a exportação do RoadNet) ----------
const MAPA_MON = {
  numped: ["NUMPED", "PEDIDO", "NUMERO DO PEDIDO", "NUM PEDIDO", "N PEDIDO", "NUMPEDIDO"],
  carregamento: ["NUMCAR", "NUMCARREGAMENTO", "CARREGAMENTO", "NUMCARGA", "CARGA", "NUM CARREGAMENTO"],
  data: ["DTSAIDA", "DATA SAIDA", "DT SAIDA", "DTMON", "DTMONTAGEM", "DATA MONTAGEM", "DTCARGA", "DATA CARREGAMENTO", "DTCARREGAMENTO", "DATA", "SESSAO DE ROTEIRIZACAO"],
  placa: ["PLACA", "VEICULO"],
  destino: ["DESTINO", "DESCRICAO DA ROTA", "ID DA ROTA"],
  motorista: ["MOTORISTA", "NOMEMOTORISTA"],
  cliente: ["NOMECLIENTE", "CLIENTE"],
  peso: ["PESOBRUTOTOT", "TOTPESO", "PESO", "ENTREGA PESO"],
  valor: ["VLTOTAL", "VALOR", "ENTREGA VALOR"],
  estado: ["ESTADO DA ORDEM"],
};
export function lerMontados(matriz) {
  const c = cabecalho(matriz, MAPA_MON, ["numped", "carregamento"]);
  if (!c) return { pedidos: [], ignoradas: 0, erro: "Não achei a coluna do pedido (NUMPED) nem do carregamento (NUMCAR). Cole os montados com o cabeçalho." };
  const pedidos = new Map();
  let ignoradas = 0, naoAtendidos = 0;
  for (const r of matriz.slice(c.i + 1)) {
    const v = (k) => (c.idx[k] >= 0 ? r[c.idx[k]] : "");
    const numped = inteiro(v("numped"));
    const carregamento = inteiro(v("carregamento"));
    if ((!numped || numped.length < 4) && !carregamento) { ignoradas++; continue; }
    if (/NAO ATENDID/.test(sem(v("estado")))) { naoAtendidos++; continue; } // "Não atendido" nunca conta como montado
    const k = numped || `CAR-${carregamento}`;
    if (pedidos.has(k)) continue;
    pedidos.set(k, {
      numped,
      carregamento,
      data: lerData(v("data")),
      placa: txt(v("placa")).toUpperCase(),
      destino: txt(v("destino")).toUpperCase(),
      motorista: txt(v("motorista")).toUpperCase(),
      cliente: txt(v("cliente")).toUpperCase(),
      peso: numero(v("peso")) || 0,
      valor: numero(v("valor")) || 0,
    });
  }
  const lista = [...pedidos.values()];
  return { pedidos: lista, ignoradas, naoAtendidos, porCarregamento: c.idx.numped < 0, erro: lista.length ? "" : "Nenhum pedido montado encontrado." };
}

// ---------- comparação ----------
const diaMs = 86400000;
const meioDia = (iso) => Date.parse(`${iso}T12:00:00Z`);
export const diasEntre = (de, ate) => (de && ate ? Math.max(0, Math.round((meioDia(ate) - meioDia(de)) / diaMs)) : null);

export const SITUACOES = {
  BACKLOG: { rot: "Backlog", dica: "Carregamento antigo: já foi montado, mas ainda está na carteira (não foi separado)", classe: "bk-backlog" },
  NAO_MONTADO: { rot: "Não montado", dica: "Liberado e ainda sem carregamento", classe: "bk-l" },
  MONTADO: { rot: "Montado", dica: "Liberado e montado nesta montagem", classe: "bk-m" },
};

// liberados: lista de lerLiberados · montados: lista de lerMontados (ou null) · dataRef: "aaaa-mm-dd"
export function comparar(liberados, montados, dataRef) {
  const temMontados = !!(montados && montados.length);
  const porPed = new Map(), porCar = new Map();
  for (const m of montados || []) {
    if (m.numped) porPed.set(m.numped, m);
    if (m.carregamento && !porCar.has(m.carregamento)) porCar.set(m.carregamento, m);
  }
  const noLib = new Set();
  const pedidos = liberados.map((p) => {
    noLib.add(p.numped);
    const m = porPed.get(p.numped) || (p.carregamento ? porCar.get(p.carregamento) : null);
    const carregamento = p.carregamento || m?.carregamento || "";
    const dataCarga = m?.data || null;
    let situacao;
    if (m) situacao = dataCarga && dataCarga < dataRef ? "BACKLOG" : "MONTADO";
    else if (carregamento || p.posicao === "M") situacao = temMontados ? "BACKLOG" : "MONTADO"; // sem os montados colados não dá para separar
    else situacao = "NAO_MONTADO";
    return {
      ...p,
      carregamento,
      placa: p.placa || m?.placa || "",
      destino: p.destino || m?.destino || "",
      data_carga: dataCarga,
      situacao,
      dias: diasEntre(p.data_liberacao, dataRef),
    };
  });
  // montados que não estão mais na carteira: já foram separados / faturados
  const sairam = (montados || []).filter((m) => m.numped && !noLib.has(m.numped));
  // backlog agrupado por carregamento
  const cars = new Map();
  for (const p of pedidos.filter((x) => x.situacao === "BACKLOG")) {
    const k = p.carregamento || "(sem nº)";
    const g = cars.get(k) || { carregamento: k, placa: p.placa, destino: p.destino, data_carga: p.data_carga, pedidos: [], peso: 0, valor: 0, libMaisAntiga: p.data_liberacao, dias: 0 };
    g.pedidos.push(p); g.peso += p.peso; g.valor += p.valor;
    if (p.data_liberacao && (!g.libMaisAntiga || p.data_liberacao < g.libMaisAntiga)) g.libMaisAntiga = p.data_liberacao;
    g.dias = Math.max(g.dias, p.dias || 0);
    g.placa ||= p.placa; g.destino ||= p.destino; g.data_carga ||= p.data_carga;
    cars.set(k, g);
  }
  const carregamentos = [...cars.values()].sort((a, b) => b.dias - a.dias || b.valor - a.valor);
  return { pedidos, sairam, carregamentos, temMontados };
}

export const FAIXAS = [
  { k: "0", rot: "Hoje", min: 0, max: 0, cor: "#22a35a" },
  { k: "1", rot: "1 dia", min: 1, max: 1, cor: "#84cc16" },
  { k: "2", rot: "2 dias", min: 2, max: 2, cor: "#f59e0b" },
  { k: "3", rot: "3 dias", min: 3, max: 3, cor: "#f97316" },
  { k: "4-6", rot: "4 a 6 dias", min: 4, max: 6, cor: "#ef4444" },
  { k: "7+", rot: "7+ dias", min: 7, max: Infinity, cor: "#991b1b" },
];
export const faixaDe = (d) => (d == null ? null : FAIXAS.find((f) => d >= f.min && d <= f.max));
