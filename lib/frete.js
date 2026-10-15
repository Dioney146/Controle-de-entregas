import { sb } from "./supabase";
import { fmtData } from "./util";

// Desfaz o frete de uma data.
// - veículos "a sair" (PROGRAMADO) são apagados
// - veículos que já saíram só são apagados se a pessoa confirmar (eles somem do Retorno e do Histórico)
// Retorna true se apagou algo.
export async function desfazerFrete(data) {
  const { data: linhas, error } = await sb().from("saidas").select("id,status").eq("data", data).eq("arquivado", false);
  if (error) { alert(error.message); return false; }
  const aSair = linhas.filter((l) => l.status === "PROGRAMADO");
  const sairam = linhas.filter((l) => l.status !== "PROGRAMADO");
  if (!linhas.length) { alert(`Não há frete em ${fmtData(data)} fora do histórico.`); return false; }

  let apagarSairam = false;
  if (aSair.length) {
    if (!confirm(`Desfazer o frete de ${fmtData(data)}?\n\n${aSair.length} veículo(s) a sair serão retirados do frete.\nA programação continua salva: é só clicar em "Gerar frete" de novo.`)) return false;
  }
  if (sairam.length) {
    apagarSairam = confirm(
      `${sairam.length} veículo(s) desse frete já tiveram SAÍDA registrada.\n\n` +
      `OK = apagar também esses (somem do Retorno e do Histórico)\n` +
      `Cancelar = manter esses e apagar só os que ainda não saíram`
    );
    if (!aSair.length && !apagarSairam) return false;
  }

  let q = sb().from("saidas").delete().eq("data", data).eq("arquivado", false); // o que já está no histórico nunca é apagado
  if (!apagarSairam) q = q.eq("status", "PROGRAMADO");
  const { error: e2 } = await q;
  if (e2) { alert(e2.message); return false; }
  return true;
}

const np = (p) => String(p || "").trim().toUpperCase().replace(/[\s-]/g, "");
const igual = (a, b) => (a ?? null) === (b ?? null) || Number(a) === Number(b);

// Junta a programação (RoadNet) com o frete JÁ GERADO de uma data, sem refazer nada:
//  - veículo novo na programação  -> entra no frete (como "a sair")
//  - veículo que já está no frete e ainda não saiu -> atualiza entregas, KG e valor
//  - nunca apaga nem mexe em motorista/entregador/saída/Infor; o que saiu da programação só é avisado
// itens: [{ placa, paradas, peso, valor, destino, tipo }] de UMA data
export async function sincronizarFrete(data, itens, { mapaVeic = {}, zonaDe = () => "", email = null } = {}) {
  const { data: frete, error } = await sb().from("saidas").select("*").eq("data", data);
  if (error) throw error;
  if (!frete.length) return null; // ainda não tem frete nessa data: nada a fazer

  const achar = (placa) => frete.find((s) => np(s.placa) === placa) || frete.find((s) => np(s.placa_original) === placa);
  const liberado = frete.some((s) => s.liberado_retorno);
  const temManual = "manual" in frete[0];
  let ordem = Math.max(0, ...frete.map((s) => s.ordem || 0));
  const novos = [], atualizados = [];

  for (const it of itens) {
    const placa = np(it.placa);
    if (!placa) continue;
    const s = achar(placa);
    if (!s) {
      const v = mapaVeic[placa] || {};
      novos.push({
        data, zona: zonaDe(it.destino), placa,
        transportadora: v.transportadora || "", tipo: v.tipo || it.tipo || "",
        entregas: it.paradas ?? null, kg: it.peso ?? null, valor: it.valor ?? null,
        destino: it.destino || "", motorista: "", entregador: "", status: "PROGRAMADO",
        ordem: ++ordem,
        ...(liberado ? { liberado_retorno: true, liberado_retorno_em: new Date().toISOString(), liberado_retorno_por: email } : {}),
      });
      continue;
    }
    if (s.status !== "PROGRAMADO" || s.arquivado) continue; // já saiu / no histórico: não mexe
    const campos = {};
    if (!igual(s.entregas, it.paradas)) campos.entregas = it.paradas ?? null;
    if (!igual(s.kg, it.peso)) campos.kg = it.peso ?? null;
    if (!igual(s.valor, it.valor)) campos.valor = it.valor ?? null;
    if (temManual && s.manual) campos.manual = false; // agora veio da programação
    if (Object.keys(campos).length) atualizados.push({ id: s.id, placa: s.placa, campos });
  }

  if (novos.length) {
    const { error: e } = await sb().from("saidas").insert(novos);
    if (e) throw e;
  }
  for (const a of atualizados) {
    const { error: e } = await sb().from("saidas").update(a.campos).eq("id", a.id);
    if (e) throw e;
  }
  // no frete (a sair), vieram da programação, mas não estão mais nela: só avisa (excluir pede justificativa no Frete)
  const naProg = new Set(itens.map((i) => np(i.placa)));
  const fora = frete.filter((s) => s.status === "PROGRAMADO" && !s.arquivado && !s.manual
    && !naProg.has(np(s.placa)) && !naProg.has(np(s.placa_original))).map((s) => s.placa);
  return { novos: novos.map((n) => n.placa), atualizados: atualizados.map((a) => a.placa), fora };
}

export function resumoSincronizacao(data, r) {
  if (!r) return "";
  const partes = [];
  if (r.novos.length) partes.push(`+${r.novos.length} veículo(s) no frete: ${r.novos.join(", ")}`);
  if (r.atualizados.length) partes.push(`${r.atualizados.length} atualizado(s) (entregas/KG/valor)`);
  if (r.fora.length) partes.push(`não estão mais na programação: ${r.fora.join(", ")} (continuam no frete; para tirar, use ✕ no Frete)`);
  return partes.length ? `Frete de ${fmtData(data)} atualizado — ${partes.join(" · ")}.` : `Frete de ${fmtData(data)} já estava igual à programação.`;
}
