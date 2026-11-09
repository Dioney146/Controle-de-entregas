import { URL_REENTREGAS, URL_DEVOLUCOES, pedir } from "../../../lib/sitesIrmaos";

export const dynamic = "force-dynamic";

// "02/10/2026" | "2026-10-02" | "02/10/2026 14:00" -> "2026-10-02"
function iso(s) {
  s = String(s ?? "").trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);
const placa = (p) => String(p || "").toUpperCase().replace(/[\s-]/g, "");

// Reentregas (site de Transferências) e devoluções (site de Devoluções) de um período.
// GET /api/indicadores?de=2026-11-01&ate=2026-11-05
export async function GET(req) {
  let nome = "";
  try { nome = decodeURIComponent(String(req.headers.get("x-usuario") || "")).trim(); } catch {}
  if (!nome) return Response.json({ erro: "Entre no site com o seu nome." }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const de = u.get("de") || "", ate = u.get("ate") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return Response.json({ erro: "Período inválido." }, { status: 400 });
  const dentro = (d) => d && d >= de && d <= ate;

  const [tr, dv] = await Promise.allSettled([
    pedir(URL_REENTREGAS, "/api/dados", nome),
    pedir(URL_DEVOLUCOES, "/api/dados", nome),
  ]);

  const erros = {};
  let reentregas = [];
  if (tr.status === "fulfilled" && Array.isArray(tr.value.json.linhas)) {
    reentregas = tr.value.json.linhas
      .map((l) => ({
        data: iso(l.dt_transferencia) || iso(l.criado_em),
        numnota: String(l.numnota || "").trim(), numped: String(l.numped || "").trim(), codcli: String(l.codcliente || "").replace(/\.0+$/, "").trim(),
        cliente: String(l.nomecliente || "").toUpperCase(), valor: num(l.vltotal), peso: num(l.pesobrutotot),
        motivo: String(l.motivo || "").toUpperCase().trim(), placa: placa(l.placa_road),
        status: String(l.status || ""), bairro: l.bairro || "",
        motorista: String(l.motorista || "").toUpperCase(), entregador: String(l.entregador || "").toUpperCase(),
      }))
      .filter((l) => dentro(l.data));
  } else {
    erros.reentregas = tr.status === "rejected" ? tr.reason.message : tr.value.json.erro || `erro ${tr.value.status}`;
  }

  let devolucoes = [];
  if (dv.status === "fulfilled" && Array.isArray(dv.value.json.linhas)) {
    devolucoes = dv.value.json.linhas
      .map((l) => ({
        dt_entrada: iso(l.dt_entrada), dt_entrega: iso(l.dt_entrega) || iso(l.dt_saida),
        nota_venda: String(l.nota_venda || "").trim(), nota_devolucao: String(l.nota_devolucao || "").trim(),
        cliente: String(l.cliente || "").toUpperCase(), valor: num(l.valor), peso: num(l.peso),
        motivo: String(l.motivo || "").toUpperCase().trim(), placa: placa(l.placa),
        transportadora: String(l.transportadora || "").toUpperCase(),
        placa_retorno: placa(l.placa_retorno), destino: String(l.destino || "").toUpperCase(),
        motorista: /NÃO IDENT/.test(l.motorista || "") ? "" : String(l.motorista || "").toUpperCase(),
        entregador: /NÃO IDENT/.test(l.entregador || "") ? "" : String(l.entregador || "").toUpperCase(),
      }))
      .filter((l) => dentro(l.dt_entrada) || dentro(l.dt_entrega));
  } else {
    erros.devolucoes = dv.status === "rejected" ? dv.reason.message : dv.value.json.erro || `erro ${dv.value.status}`;
  }

  return Response.json({ reentregas, devolucoes, erros });
}
