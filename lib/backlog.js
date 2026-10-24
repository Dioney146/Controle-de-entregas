// Backlog: compara o relatório de LIBERADOS com o de MONTADOS (os dois do Winthor, mesmo formato:
// NUMPED, CODCLI, NUMNOTA, CODFILIAL, NOMECLIENTE, POSICAO, DATA, HORA, MINUTO, DTENTREGA, NOMERCA,
// NOMESUP, PESOBRUTOTOT, VLTOTAL, CIDADE, PRACA, NUMCARREGAMENTO, DESTINO, PLACA…).
//  1) Fora da roteirização: pedido liberado que NÃO está nos montados.
//  2) Backlog: pedido montado que NÃO está nos liberados e com DATA anterior a hoje
//     (montado antes e ainda sem separação) — agrupado por carregamento.
// Nada é gravado: o painel mostra só o que foi colado.
import { lerNumeroBR } from "./util";

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const chave = (s) => sem(s).replace(/[^A-Z0-9]/g, "");
const txt = (v) => String(v ?? "").trim();
// "123.0" (número do Excel) -> "123"; "5.967.003.000" (com milhar) -> "5967003000"
const inteiro = (v) => txt(v).replace(/^(\d+)[.,]0+$/, "$1").replace(/\D/g, "").replace(/^0+$/, "");
const numero = (v) => (typeof v === "number" ? v : lerNumeroBR(v)) || 0;

// data em qualquer formato: "21/10/2026", "21/10/2026 00:00:00", Date do Excel, número serial do Excel
export function lerData(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 12 * 3600000); // meio-dia: evita cair no dia anterior por causa do fuso
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = txt(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// texto colado -> matriz (linhas x colunas)
export const textoParaMatriz = (t) => String(t || "").replace(/\r/g, "").split("\n").filter((l) => l.trim()).map((l) => l.split("\t"));

const MAPA = {
  numped: ["NUMPED", "PEDIDO"],
  codcli: ["CODCLI"],
  cliente: ["NOMECLIENTE", "CLIENTE"],
  posicao: ["POSICAO"],
  data: ["DATA"],
  hora: ["HORA"],
  minuto: ["MINUTO"],
  dt_entrega: ["DTENTREGA"],
  rca: ["NOMERCA"],
  supervisor: ["NOMESUP"],
  peso: ["PESOBRUTOTOT", "PESO"],
  valor: ["VLTOTAL", "VALOR"],
  cidade: ["CIDADE"],
  praca: ["PRACA"],
  carregamento: ["NUMCARREGAMENTO", "NUMCAR"],
  destino: ["DESTINO"],
  placa: ["PLACA"],
};

// matriz (colada ou do arquivo) -> { pedidos, ignoradas, erro }
export function lerRelatorio(matriz) {
  let iCab = -1, idx = null;
  for (let i = 0; i < Math.min(matriz.length, 40) && iCab < 0; i++) {
    const cab = matriz[i].map(chave);
    if (cab.includes("NUMPED")) {
      iCab = i;
      idx = Object.fromEntries(Object.entries(MAPA).map(([k, nomes]) => [k, nomes.map((n) => cab.indexOf(n)).find((x) => x >= 0) ?? -1]));
    }
  }
  if (iCab < 0) return { pedidos: [], ignoradas: 0, erro: "Não achei a coluna NUMPED. Cole o relatório do Winthor junto com o cabeçalho." };
  const pedidos = new Map();
  let ignoradas = 0;
  for (const r of matriz.slice(iCab + 1)) {
    const v = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
    const numped = inteiro(v("numped"));
    if (!numped || numped.length < 4) { ignoradas++; continue; } // linha de total / rodapé
    const hora = txt(v("hora")), minuto = txt(v("minuto"));
    pedidos.set(numped, {
      numped,
      codcli: inteiro(v("codcli")),
      cliente: txt(v("cliente")).toUpperCase(),
      posicao: sem(v("posicao")).slice(0, 1),
      data: lerData(v("data")),
      hora: hora ? `${hora.padStart(2, "0")}:${(minuto || "0").padStart(2, "0")}` : "",
      dt_entrega: lerData(v("dt_entrega")),
      rca: txt(v("rca")).toUpperCase(),
      supervisor: txt(v("supervisor")).toUpperCase(),
      peso: numero(v("peso")),
      valor: numero(v("valor")),
      cidade: txt(v("cidade")).toUpperCase(),
      praca: txt(v("praca")).toUpperCase(),
      carregamento: inteiro(v("carregamento")),
      destino: txt(v("destino")).toUpperCase(),
      placa: txt(v("placa")).toUpperCase(),
    });
  }
  const lista = [...pedidos.values()];
  return { pedidos: lista, ignoradas, erro: lista.length ? "" : "Nenhum pedido encontrado." };
}

export const somar = (l) => ({ qtd: l.length, peso: l.reduce((s, p) => s + (p.peso || 0), 0), valor: l.reduce((s, p) => s + (p.valor || 0), 0) });
const meioDia = (iso) => Date.parse(`${iso}T12:00:00Z`);
export const diasEntre = (de, ate) => (de && ate ? Math.max(0, Math.round((meioDia(ate) - meioDia(de)) / 86400000)) : null);

// liberados / montados: listas de lerRelatorio · hoje: "aaaa-mm-dd"
export function comparar(liberados, montados, hoje) {
  const noLib = new Set(liberados.map((p) => p.numped));
  const noMon = new Set(montados.map((p) => p.numped));
  const monPorPed = new Map(montados.map((p) => [p.numped, p]));
  // roteirizados: destino / placa / carregamento vêm dos montados (nos liberados vem "DEV FORN/S. REMESSA")
  const roteirizados = liberados.filter((p) => noMon.has(p.numped)).map((p) => {
    const m = monPorPed.get(p.numped);
    return { ...p, destino: m.destino, placa: m.placa, carregamento: m.carregamento };
  });
  const fora = liberados.filter((p) => !noMon.has(p.numped)).map((p) => ({ ...p, dias: diasEntre(p.data, hoje) }));
  const montSemLib = montados.filter((p) => !noLib.has(p.numped));
  const deHoje = montSemLib.filter((p) => !p.data || p.data >= hoje); // entraram hoje: desconsiderar
  const antigos = montSemLib.filter((p) => p.data && p.data < hoje).map((p) => ({ ...p, dias: diasEntre(p.data, hoje) }));

  const g = new Map();
  for (const p of antigos) {
    const k = p.carregamento || "(sem carregamento)";
    const c = g.get(k) || { carregamento: k, placa: p.placa, destino: p.destino, pedidos: [], peso: 0, valor: 0, dataMin: p.data, dataMax: p.data };
    c.pedidos.push(p); c.peso += p.peso; c.valor += p.valor;
    if (p.data < c.dataMin) c.dataMin = p.data;
    if (p.data > c.dataMax) c.dataMax = p.data;
    c.placa ||= p.placa; c.destino ||= p.destino;
    g.set(k, c);
  }
  const carregamentos = [...g.values()]
    .map((c) => ({ ...c, dias: diasEntre(c.dataMin, hoje) }))
    .sort((a, b) => a.dataMin.localeCompare(b.dataMin) || String(a.carregamento).localeCompare(String(b.carregamento)));
  return { roteirizados, fora, antigos, deHoje, carregamentos };
}

export const corDias = (d) => (d == null ? "#98a2b3" : d <= 1 ? "#f59e0b" : d === 2 ? "#f97316" : d <= 6 ? "#ef4444" : "#991b1b");

// agrupa uma lista de pedidos por um campo (ou função) -> [{ k, qtd, peso, valor }] ordenado pela métrica
export function agrupar(lista, campo, metrica = "valor") {
  const f = typeof campo === "function" ? campo : (p) => p[campo];
  const m = new Map();
  for (const p of lista) {
    const k = f(p) || "—";
    const g = m.get(k) || { k, qtd: 0, peso: 0, valor: 0 };
    g.qtd++; g.peso += p.peso || 0; g.valor += p.valor || 0;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b[metrica] - a[metrica]);
}

// categorias do dashboard (cores validadas para daltonismo em pares vizinhos)
export const CATEGORIAS = {
  BACKLOG: { rot: "Montados e não separados", dica: "Montados em dias anteriores que não estão nos liberados (separação não finalizada)", cor: "#b91c1c" },
  FORA: { rot: "Fora da roteirização", dica: "Liberados que não estão nos montados", cor: "#0369a1" },
  ROTEIRIZADOS: { rot: "Roteirizados", dica: "Liberados que estão nos montados", cor: "#6d28d9" },
  HOJE: { rot: "Montados de hoje fora dos liberados", dica: "Entraram hoje na carteira — desconsiderados do backlog", cor: "#15803d" },
};
