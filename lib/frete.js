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
