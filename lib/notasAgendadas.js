// Notas agendadas: notas fiscais de agendamento (ex.: J A GOMES) faturadas em placa fictícia
// e roteirizadas depois numa placa de verdade (igual ao site de Transferências/Reentregas).
import { lerNumeroBR, normPlaca } from "./util";

export const PLACAS_FICTICIAS = ["AAA3502", "AAA3505", "AAA3506"];
export const CLIENTE_PADRAO = "J A GOMES ALIMENTOS";

const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const chave = (s) => sem(s).replace(/[^A-Z0-9]/g, "");
const txt = (v) => String(v ?? "").trim();
// "123.0" -> "123"; "5.967.003" -> "5967003"
const inteiro = (v) => txt(v).replace(/^(\d+)[.,]0+$/, "$1").replace(/\D/g, "").replace(/^0+$/, "");

const MAPA = {
  numnota: ["NUMNOTA", "NOTA", "NF", "NOTAFISCAL", "NFE", "NUMERONOTA", "NUMERODANOTA"],
  numped: ["NUMPED", "PEDIDO", "NUMERODOPEDIDO"],
  codcli: ["CODCLI", "CODCLIENTE", "CODIGODOCLIENTE"],
  cliente: ["NOMECLIENTE", "CLIENTE", "RAZAOSOCIAL"],
  valor: ["VLTOTAL", "VALOR", "VALORTOTAL", "VLNOTA"],
  peso: ["PESOBRUTOTOT", "PESO", "PESOBRUTO", "TOTPESO"],
  carregamento: ["NUMCARREGAMENTO", "NUMCAR", "CARREGAMENTO"],
  destino: ["DESTINO"],
  placa_ficticia: ["PLACA", "PLACAFICTICIA"],
};

// texto colado: com cabeçalho (NUMNOTA, CLIENTE, VALOR…) ou só uma lista de números de nota
// padrao = { cliente, placa_ficticia, destino } usados quando a coluna não vier no texto
export function lerColagem(texto, padrao = {}) {
  const linhas = String(texto || "").replace(/\r/g, "").split("\n").filter((l) => l.trim()).map((l) => l.split("\t"));
  if (!linhas.length) return { notas: [], erro: "" };
  let iCab = -1, idx = null;
  for (let i = 0; i < Math.min(linhas.length, 20) && iCab < 0; i++) {
    const cab = linhas[i].map(chave);
    const iNota = MAPA.numnota.map((n) => cab.indexOf(n)).find((x) => x >= 0);
    if (iNota !== undefined) {
      iCab = i;
      idx = Object.fromEntries(Object.entries(MAPA).map(([k, nomes]) => [k, nomes.map((n) => cab.indexOf(n)).find((x) => x >= 0) ?? -1]));
    }
  }
  const notas = new Map();
  if (iCab < 0) {
    // sem cabeçalho: cada número com 4+ dígitos é uma nota
    for (const n of String(texto).match(/\d{4,}/g) || []) {
      if (!notas.has(n)) notas.set(n, { numnota: n, numped: "", codcli: "", cliente: padrao.cliente || "", valor: null, peso: null, carregamento: "", destino: padrao.destino || "", placa_ficticia: padrao.placa_ficticia || PLACAS_FICTICIAS[0] });
    }
  } else {
    for (const r of linhas.slice(iCab + 1)) {
      const v = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
      const numnota = inteiro(v("numnota"));
      if (!numnota || numnota.length < 3 || notas.has(numnota)) continue; // total / repetida
      notas.set(numnota, {
        numnota,
        numped: inteiro(v("numped")),
        codcli: inteiro(v("codcli")),
        cliente: (txt(v("cliente")) || padrao.cliente || "").toUpperCase(),
        valor: lerNumeroBR(v("valor")),
        peso: lerNumeroBR(v("peso")),
        carregamento: inteiro(v("carregamento")),
        destino: (txt(v("destino")) || padrao.destino || "").toUpperCase(),
        placa_ficticia: normPlaca(v("placa_ficticia")) || padrao.placa_ficticia || PLACAS_FICTICIAS[0],
      });
    }
  }
  const lista = [...notas.values()];
  return { notas: lista, semCabecalho: iCab < 0, erro: lista.length ? "" : "Nenhuma nota fiscal encontrada no texto." };
}

// motorista / entregador da placa no frete do dia (pela placa atual ou pela placa original, se foi trocada)
export function nomesDoFrete(saidasDoDia, placa) {
  const p = normPlaca(placa);
  if (!p) return null;
  const s = saidasDoDia.find((x) => normPlaca(x.placa) === p) || saidasDoDia.find((x) => normPlaca(x.placa_original) === p);
  // trocada: a placa digitada é a antiga; vale a placa atual do frete
  return s ? { motorista: s.motorista || "", entregador: s.entregador || "", destino: s.destino || s.zona || "", status: s.status, placaAtual: normPlaca(s.placa), trocada: normPlaca(s.placa) !== p } : null;
}

export const somar = (l) => ({ qtd: l.length, peso: l.reduce((s, n) => s + (Number(n.peso) || 0), 0), valor: l.reduce((s, n) => s + (Number(n.valor) || 0), 0) });

// busca notas fiscais na ROAD (planilha do site de Reentregas) pelo servidor do site
export async function buscarNaRoad(nfs, usuario) {
  const r = await fetch(`/api/nota?nfs=${encodeURIComponent(nfs.join(","))}`, { headers: { "x-usuario": encodeURIComponent(usuario || "site") }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.semConfig ? "a planilha não está configurada neste site (variável STREAMLIT_SECRETS na Vercel)." : j.erro || `erro ${r.status}`);
  return { achadas: j.achadas || {}, faltando: j.faltando || [] };
}

// nota colada + dados da ROAD: o que veio colado vale; a ROAD completa o que faltar
export function completarComRoad(n, a, padrao = {}) {
  if (!a) return n;
  const colado = (v) => v != null && v !== "" && v !== padrao.cliente && v !== padrao.destino && v !== padrao.placa_ficticia;
  return {
    ...n,
    numped: n.numped || a.numped || "",
    codcli: n.codcli || a.codcli || "",
    cliente: colado(n.cliente) ? n.cliente : a.cliente || n.cliente,
    valor: n.valor ?? a.valor,
    peso: n.peso ?? a.peso,
    carregamento: n.carregamento || a.carregamento || "",
    destino: colado(n.destino) ? n.destino : a.destino || n.destino,
    placa_ficticia: colado(n.placa_ficticia) ? n.placa_ficticia : normPlaca(a.placa_road) || n.placa_ficticia,
  };
}
