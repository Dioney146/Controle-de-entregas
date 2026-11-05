// Acesso, pelo servidor, aos outros dois sites (Transferências/Reentregas e Devoluções).
// Eles já leem as planilhas do Google; o Controle entra lá com o nome de quem está usando
// (mesmo login sem senha) e pede os dados. Não precisa configurar nada na Vercel.
export const URL_REENTREGAS = (process.env.URL_TRANSFERENCIAS || process.env.NEXT_PUBLIC_URL_TRANSFERENCIAS || "https://reentregas-dellys.vercel.app").replace(/\/+$/, "");
export const URL_DEVOLUCOES = (process.env.URL_DEVOLUCOES || process.env.NEXT_PUBLIC_URL_DEVOLUCOES || "https://devolucoes-dellys.vercel.app").replace(/\/+$/, "");

const sessoes = new Map(); // "site|nome" -> cookie

async function entrar(base, nome) {
  const k = `${base}|${nome}`;
  if (sessoes.has(k)) return sessoes.get(k);
  let r;
  try {
    r = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: nome }), cache: "no-store" });
  } catch (e) {
    throw new Error(`não consegui falar com ${base} (${e?.cause?.code || e.message})`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${base} recusou a entrada: ${j.erro || r.status}`);
  const cookie = (r.headers.getSetCookie?.() || [r.headers.get("set-cookie") || ""]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error(`${base} não devolveu a sessão.`);
  sessoes.set(k, cookie);
  return cookie;
}

// GET em um dos sites, já logado. Devolve { status, json }.
export async function pedir(base, caminho, nome, tentou = false) {
  const cookie = await entrar(base, nome);
  const r = await fetch(`${base}${caminho}`, { headers: { cookie }, cache: "no-store" });
  if (r.status === 401 && !tentou) { sessoes.delete(`${base}|${nome}`); return pedir(base, caminho, nome, true); }
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
