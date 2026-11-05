// Busca de notas fiscais na aba ROAD da planilha do Google — a MESMA base do site de
// Transferências / Reentregas (mesma lógica de colunas do buscarNota de lá). Roda só no servidor.
import { lerAbas } from "./planilha";
import { segredos } from "./segredos";
import { URL_REENTREGAS, pedir } from "./sitesIrmaos";

let base = null;
let baseEm = 0;
async function lerRoad() {
  if (base && Date.now() - baseEm < 60000) return base; // cache de 1 min para não estourar a cota do Google
  const v = await lerAbas(["ROAD"]);
  const vals = v.ROAD || [];
  base = { cols: (vals[0] || []).map((c) => String(c).toUpperCase().trim()), rows: vals.slice(1) };
  baseEm = Date.now();
  return base;
}

const limpo = (v) => {
  const s = String(v ?? "").trim();
  if (["", "nan", "None"].includes(s)) return "";
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};
// número da planilha: "1.234,56" / "1234.56" / "R$ 1.234,56"
function numero(v) {
  let s = String(v ?? "").replace(/R\$/g, "").replace(/\s/g, "");
  if (!s) return null;
  const c = s.lastIndexOf(","), p = s.lastIndexOf(".");
  if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (c >= 0) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
// "02/10/2026" -> "2026-10-02"
function dataISO(v) {
  const s = limpo(v);
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

// colunas da ROAD (pelo nome do cabeçalho, igual ao site de Transferências)
function mapear(C) {
  const idx = (c) => (c ? C.indexOf(c) : -1);
  const um = (f) => C.filter(f);
  const colNF = C.find((c) => (c.includes("NOTA") && c.includes("FISCAL")) || ["NF", "NOTAFISCAL", "NOTA_FISCAL"].includes(c));
  let peso = um((c) => ["PESO", "PESO BRUTO", "PESOBRUTO", "PESO TOTAL"].includes(c));
  if (!peso.length) peso = um((c) => c.includes("PESO"));
  let valor = um((c) => ["VALOR", "VALOR TOTAL", "VL TOTAL"].includes(c));
  if (!valor.length) valor = um((c) => c.includes("VALOR"));
  const prior = um((c) => ["CLIENTE", "NOMECLIENTE", "NOME CLIENTE", "NOME_CLIENTE"].includes(c));
  const cliente = [...prior, ...um((c) => c.includes("CLIEN") && !c.includes("COD") && !prior.includes(c))];
  const cod = um((c) => ["CODIGO DO CLIENTE", "CODIGO_DO_CLIENTE", "CODCLIENTE", "COD_CLI", "CODIGO CLIENTE", "CODIGO_CLIENTE"].includes(c) || (c.includes("COD") && c.includes("CLI")));
  let dtlib = C.find((c) => c.includes("DATA") && c.includes("LIB")) || C.find((c) => c.includes("LIBERADO") || c.includes("LIBERACAO"));
  return {
    nf: idx(colNF),
    pedido: um((c) => ["PEDIDO", "NUMPED", "NUMERO DO PEDIDO", "N PEDIDO", "NUM PEDIDO"].includes(c)).map(idx),
    cliente: cliente.map(idx), cod: cod.map(idx),
    peso: peso.map(idx), valor: valor.map(idx),
    carreg: um((c) => c.startsWith("CARREG") || c === "NUMCARREGAMENTO" || c === "NUMCAR").map(idx),
    praca: um((c) => c.includes("PRA")).map(idx),
    destino: um((c) => c.includes("DEST")).map(idx),
    placa: um((c) => c.includes("PLACA")).map(idx),
    dtlib: idx(dtlib),
    dtentrega: idx(C.find((c) => c.includes("DATA") && c.includes("ENTREG"))),
  };
}
const primeiro = (r, is) => { for (const i of is) { const v = limpo(r[i]); if (v) return v; } return ""; };

// nfs: lista de números -> { achadas: { [nf]: {...} }, faltando: [nf] }
async function buscarNaPlanilha(nfs) {
  const { cols, rows } = await lerRoad();
  if (!cols.length) throw new Error("Aba ROAD vazia ou não encontrada na planilha.");
  const M = mapear(cols);
  if (M.nf < 0) throw new Error("A aba ROAD não tem a coluna NOTA FISCAL.");
  const quero = new Set(nfs.map((n) => String(n).replace(/\D/g, "").replace(/^0+/, "")).filter(Boolean));
  const achadas = {};
  for (const r of rows) {
    const nf = String(r[M.nf] ?? "").split(".")[0].trim().replace(/\D/g, "").replace(/^0+/, "");
    if (!nf || !quero.has(nf) || achadas[nf]) continue;
    const cod = M.cod.map((i) => limpo(r[i])).find((v) => v && v !== "0") || "";
    achadas[nf] = {
      numnota: nf,
      numped: primeiro(r, M.pedido).replace(/\D/g, ""),
      codcli: cod,
      cliente: primeiro(r, M.cliente).toUpperCase(),
      valor: numero(r[M.valor[0]]),
      peso: numero(r[M.peso[0]]),
      carregamento: primeiro(r, M.carreg).replace(/\D/g, ""),
      destino: primeiro(r, M.destino).toUpperCase(),
      praca: primeiro(r, M.praca).toUpperCase(),
      placa_road: primeiro(r, M.placa).toUpperCase().replace(/[\s-]/g, ""),
      dt_liberado: M.dtlib >= 0 ? dataISO(r[M.dtlib]) : "",
      dt_entrega: M.dtentrega >= 0 ? dataISO(r[M.dtentrega]) : "",
    };
  }
  return { achadas, faltando: [...quero].filter((n) => !achadas[n]) };
}

// ---------- sem as credenciais da planilha neste site: pergunta ao site de Reentregas ----------
// (ele já lê a mesma aba ROAD; entra lá com o nome de quem está usando o Controle)
async function umaNoReentregas(nf, nome) {
  const { status, json: j } = await pedir(URL_REENTREGAS, `/api/nota?nf=${encodeURIComponent(nf)}`, nome);
  if (!j.nota) {
    if (/não encontrada/i.test(j.erro || "")) return null;
    throw new Error(j.erro || `o site de Reentregas respondeu ${status}`);
  }
  const n = j.nota;
  return {
    numnota: String(n.numnota || nf).replace(/\D/g, ""),
    numped: String(n.numped || "").replace(/\D/g, ""),
    codcli: n.codcliente || "",
    cliente: String(n.nomecliente || "").toUpperCase(),
    valor: typeof n.vltotal === "number" ? n.vltotal : numero(n.vltotal),
    peso: typeof n.pesobrutotot === "number" ? n.pesobrutotot : numero(n.pesobrutotot),
    carregamento: String(n.numcarregamento || "").replace(/\D/g, ""),
    destino: String(n.destino || "").toUpperCase(),
    praca: String(n.praca || "").toUpperCase(),
    placa_road: String(n.placa_road || "").toUpperCase().replace(/[\s-]/g, ""),
    dt_liberado: dataISO(n.dt_liberado),
    dt_entrega: dataISO(n.data_entrega),
  };
}

async function buscarNoReentregas(nfs, nome) {
  const achadas = {}, faltando = [];
  const fila = [...nfs];
  async function trabalhador() {
    while (fila.length) {
      const nf = fila.shift();
      const a = await umaNoReentregas(nf, nome);
      if (a) achadas[nf] = { ...a, numnota: nf }; else faltando.push(nf);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, nfs.length) }, trabalhador)); // 4 de cada vez
  return { achadas, faltando, via: "reentregas" };
}

// nfs: lista de números -> { achadas: { [nf]: {...} }, faltando: [nf] }
export async function buscarNotas(nfs, nome = "") {
  const limpas = [...new Set(nfs.map((n) => String(n).replace(/\D/g, "").replace(/^0+/, "")).filter(Boolean))];
  const { email, chave, planilha } = segredos();
  if (email && chave && planilha) return { ...(await buscarNaPlanilha(limpas)), via: "planilha" };
  return buscarNoReentregas(limpas, nome);
}
