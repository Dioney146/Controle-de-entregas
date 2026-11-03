import { buscarNotas } from "../../../lib/road";

export const dynamic = "force-dynamic";

// Busca notas fiscais na aba ROAD (mesma planilha do site de Transferências / Reentregas).
// Sem configurar nada: pergunta ao site de Reentregas. Com STREAMLIT_SECRETS neste projeto: lê a planilha direto.
// GET /api/nota?nf=123456  ou  /api/nota?nfs=123,456,789
export async function GET(req) {
  // o site manda o nome de quem está usando (o mesmo do log); sem ele, não responde
  let nome = "";
  try { nome = decodeURIComponent(String(req.headers.get("x-usuario") || "")).trim(); } catch {}
  if (!nome) return Response.json({ erro: "Entre no site com o seu nome." }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const nfs = [...new Set(`${u.get("nf") || ""},${u.get("nfs") || ""}`.split(/[\s,;]+/).map((x) => x.replace(/\D/g, "")).filter(Boolean))].slice(0, 500);
  if (!nfs.length) return Response.json({ erro: "Informe o número da nota fiscal." }, { status: 400 });
  try {
    return Response.json(await buscarNotas(nfs, nome));
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 500 });
  }
}
