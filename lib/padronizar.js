// Padronização da lista de motoristas/entregadores:
//  1) nome que corresponde a uma pessoa do cadastro (Winthor/RoadNet) -> passa a ser o nome oficial
//     (ex.: ATOS, ATOS MONTEIRO -> ATOS MONTEIRO DE OLIVEIRA)
//  2) nomes repetidos (mesma pessoa escrita de vários jeitos) -> fica um só (ex.: AGEMILSON, AGEMILSON R)
//  3) diaristas -> "DG NOME" (ex.: JOAO VITOR DG, DG JOÃO VITOR -> DG JOAO VITOR)
//  4) só o primeiro nome e não dá para saber quem é (ex.: JOSE, com vários José) -> inativado
//     (sai das listas do Frete; nada é apagado do que já foi gravado no frete/histórico)
import { candidatos, cabe, normNome, ehDiarista } from "./cadastro";

const DG_PALAVRAS = /(^| )(DG|DIARISTA|DIARIST|DIARIS|DIARI|DIAR)( |$)/g;
const nucleoDiarista = (n) => {
  const x = normNome(n).replace(DG_PALAVRAS, " ").replace(DG_PALAVRAS, " ").replace(/\s+/g, " ").trim();
  const semFuncao = x.replace(/(^| )CONFERENTE( |$)/g, " ").trim();
  return semFuncao || x; // "DG CONFERENTE" sozinho continua como está
};
const umaPalavra = (n) => normNome(n).replace(DG_PALAVRAS, " ").trim().split(" ").filter(Boolean).length < 2;

// nome oficial a usar: o do RoadNet quando é igual ao do Winthor (é o que vai para o GM); senão o do Winthor (grafia certa)
// (quando Winthor e RoadNet têm grafias diferentes, vale a que já é usada na lista do site)
export function nomeOficial(c, nomesSite = null) {
  if (!c) return "";
  if (nomesSite && c.nome_winthor && c.nome_roadnet && normNome(c.nome_winthor) !== normNome(c.nome_roadnet)) {
    if (nomesSite.has(normNome(c.nome_roadnet))) return normNome(c.nome_roadnet);
    if (nomesSite.has(normNome(c.nome_winthor))) return normNome(c.nome_winthor);
  }
  const n = c.situacao === "OK" && c.nome_roadnet ? c.nome_roadnet : c.nome_winthor || c.nome_roadnet || c.nome;
  return normNome(n);
}

// semelhança entre duas palavras (0 a 1), para pegar erro de digitação no 1º nome (ARGIMIRO x ARGEMIRO)
function parecido(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
// candidatos do cadastro aceitando 1º nome com erro de digitação (só quando o resto do nome bate)
function candidatosAproximados(nome, cadastro) {
  const t = normNome(nome).split(" ");
  const limite = t.length > 1 ? 0.75 : 0.85;
  return cadastro.filter((c) => [c.nome, c.nome_winthor, c.nome_roadnet].some((x) => {
    if (!x) return false;
    const o = normNome(x).split(" ");
    const som = (w) => w.replace(/^K/, "C"); // KLEBERSON = CLEBERSON
    if (som(t[0])[0] !== som(o[0])[0] || parecido(som(t[0]), som(o[0])) < limite) return false;
    return t.length === 1 || cabe([o[0], ...t.slice(1)].join(" "), x);
  }));
}

const juntarFuncao = (fs) => {
  const s = new Set(fs);
  return s.has("AMBOS") || (s.has("MOTORISTA") && s.has("ENTREGADOR")) ? "AMBOS" : [...s][0] || "AMBOS";
};

// valores que não são pessoas (ficam como estão)
const ESPECIAL = /^(SEM |NAO SAIU|NÃO SAIU|CANCELAD|FALTOU|TERCEIRO|AGENDA|AGREGADO)/;

// pessoas: [{ id, nome, funcao, ativo, vinculo?, cadastro_nome? }]   usos: { NOME: vezes }
export function planejar(todas, cadastro, usos = {}) {
  const pessoas = todas.filter((p) => !ESPECIAL.test(normNome(p.nome)));
  const porNomeCad = new Map(cadastro.map((c) => [normNome(c.nome), c]));
  const vinc = (p) => p.vinculo || (ehDiarista(p.nome) ? "DIARISTA" : "FIXO");
  const destino = new Map(); // id -> { alvo, oficial, motivo }
  const inativar = [];
  const duvidas = [];

  // ---------- fixos: 1) cadastro oficial
  const fixos = pessoas.filter((p) => vinc(p) === "FIXO");
  const nomesSite = new Set(pessoas.map((p) => normNome(p.nome)));
  for (const p of fixos) {
    let c = p.cadastro_nome ? porNomeCad.get(normNome(p.cadastro_nome)) : null;
    if (!c) {
      let cands = candidatos(p.nome, cadastro);
      if (!cands.length) { cands = candidatosAproximados(p.nome, cadastro); if (cands.length === 1) p._parecido = true; }
      if (cands.length === 1) c = cands[0];
      else if (cands.length > 1) { p._ambiguo = cands.map((x) => nomeOficial(x, nomesSite)); }
    }
    if (c) destino.set(p.id, { alvo: nomeOficial(c, nomesSite), oficial: c.nome, motivo: p._parecido ? "parecido" : "cadastro" });
  }
  // ---------- fixos: 2) sem cadastro -> junta com o nome mais completo da própria lista (se for um só)
  const nomeFinal = (p) => destino.get(p.id)?.alvo || normNome(p.nome);
  for (const p of fixos) {
    if (destino.has(p.id)) continue;
    const maiores = fixos.filter((q) => q.id !== p.id && normNome(q.nome).length > normNome(p.nome).length && cabe(p.nome, q.nome));
    // fica só com os "mais completos" (que não cabem em outro maior) e vê para onde cada um vai
    const finais = [...new Set(maiores.filter((q) => !maiores.some((r) => r.id !== q.id && cabe(q.nome, r.nome) && normNome(r.nome).length > normNome(q.nome).length)).map(nomeFinal))];
    const ambiguo = p._ambiguo ? [...new Set(p._ambiguo)] : [];
    const opcoes = [...new Set([...finais, ...ambiguo])];
    if (opcoes.length === 1 && !(p._ambiguo && p._ambiguo.length > 1 && !finais.length)) {
      const q = maiores.find((x) => nomeFinal(x) === opcoes[0]);
      const dq = q ? destino.get(q.id) : null;
      destino.set(p.id, { alvo: opcoes[0], oficial: dq?.oficial || null, motivo: dq?.motivo === "parecido" ? "parecido" : "repetido" });
    } else if (opcoes.length > 1) {
      if (umaPalavra(p.nome)) inativar.push({ p, opcoes });
      else duvidas.push({ p, opcoes });
    }
  }

  // ---------- diaristas: "DG NOME", juntando repetidos (com e sem acento, DG antes/depois, DIARIS...)
  const diaristas = pessoas.filter((p) => vinc(p) === "DIARISTA");
  for (const p of diaristas) {
    const nucleo = nucleoDiarista(p.nome);
    if (!nucleo) continue;
    // o mais completo entre os diaristas que contém este nome
    const maiores = diaristas.filter((q) => q.id !== p.id && nucleoDiarista(q.nome).length > nucleo.length && cabe(nucleo, nucleoDiarista(q.nome)));
    const finais = [...new Set(maiores.filter((q) => !maiores.some((r) => r.id !== q.id && cabe(nucleoDiarista(q.nome), nucleoDiarista(r.nome)) && nucleoDiarista(r.nome).length > nucleoDiarista(q.nome).length)).map((q) => nucleoDiarista(q.nome)))];
    const alvo = finais.length === 1 ? finais[0] : nucleo;
    destino.set(p.id, { alvo: `DG ${alvo}`, oficial: null, motivo: finais.length === 1 ? "repetido" : "diarista" });
  }

  // quem já tem exatamente o nome de destino entra no mesmo grupo (ex.: ANDRE -> ANDRE SILVA, que já existe)
  const alvos = new Map();
  for (const [id, d] of destino) {
    const p = pessoas.find((x) => x.id === id);
    if (d.motivo !== "parecido") alvos.set(`${vinc(p)}|${d.alvo}`, d);
  }
  for (const p of pessoas) {
    if (destino.has(p.id)) continue;
    const d = alvos.get(`${vinc(p)}|${normNome(p.nome)}`);
    if (d) destino.set(p.id, { alvo: d.alvo, oficial: d.oficial, motivo: "proprio" });
  }

  // ---------- monta os grupos (todos que vão para o mesmo nome)
  const grupos = new Map();
  for (const p of pessoas) {
    const d = destino.get(p.id);
    if (!d) continue;
    // o que entrou por semelhança (erro de digitação) vira uma sugestão separada, para conferir
    const parecido = d.motivo === "parecido";
    const k = `${vinc(p)}|${d.alvo}${parecido ? "|~" : ""}`;
    if (!grupos.has(k)) grupos.set(k, { alvo: d.alvo, vinculo: vinc(p), oficial: null, pessoas: [], parecido });
    const g = grupos.get(k);
    g.pessoas.push(p);
    if (d.oficial) g.oficial = d.oficial;
  }
  const acoes = [];
  for (const g of grupos.values()) {
    const mudou = g.parecido || g.pessoas.length > 1 || g.pessoas[0].nome !== g.alvo;
    if (!mudou) continue;
    // quem fica: o que já tem o nome certo; senão o mais usado no frete
    const fica = g.pessoas.find((p) => p.nome === g.alvo)
      || [...g.pessoas].sort((a, b) => (usos[b.nome] || 0) - (usos[a.nome] || 0) || b.nome.length - a.nome.length)[0];
    acoes.push({
      tipo: g.pessoas.length > 1 ? "juntar" : "renomear",
      alvo: g.alvo,
      vinculo: g.vinculo,
      oficial: g.oficial,
      fica: fica.id,
      ids: g.pessoas.map((p) => p.id),
      parecido: g.parecido,                                  // erro de digitação provável — vem desmarcado
      primeiroNome: g.pessoas.some((p) => umaPalavra(p.nome)), // tinha só o primeiro nome
      chave: `a:${g.vinculo}|${g.alvo}${g.parecido ? "|~" : ""}`,
      de: g.pessoas.map((p) => p.nome),
      funcao: juntarFuncao(g.pessoas.map((p) => p.funcao)),
      ativo: g.pessoas.some((p) => p.ativo),
      usos: g.pessoas.reduce((s, p) => s + (usos[p.nome] || 0), 0),
    });
  }
  // os inativados que também iriam para algum grupo não entram duas vezes
  const emGrupo = new Set(acoes.flatMap((a) => a.ids));
  return {
    acoes: acoes.sort((a, b) => a.alvo.localeCompare(b.alvo)),
    inativar: inativar.filter((x) => !emGrupo.has(x.p.id) && x.p.ativo).map((x) => ({ id: x.p.id, nome: x.p.nome, opcoes: x.opcoes })),
    duvidas: duvidas.map((x) => ({ id: x.p.id, nome: x.p.nome, opcoes: x.opcoes })),
  };
}

// grava no banco: apaga os repetidos, renomeia quem fica, inativa os "só primeiro nome" sem dono
export async function aplicar(sb, plano, escolhidas, temColunas = true) {
  let feitos = 0;
  for (const a of plano.acoes.filter((x) => escolhidas.has(x.chave))) {
    // se o nome certo já existe na lista (de outra linha), junta tudo nele
    const { data: ja } = await sb.from("pessoas").select("id").eq("nome", a.alvo);
    const existente = (ja || []).find((x) => !a.ids.includes(x.id));
    if (existente) {
      const { error } = await sb.from("pessoas").delete().in("id", a.ids);
      if (error) throw error;
      feitos++;
      continue;
    }
    const apagar = a.ids.filter((id) => id !== a.fica);
    if (apagar.length) {
      const { error } = await sb.from("pessoas").delete().in("id", apagar);
      if (error) throw error;
    }
    const campos = { nome: a.alvo, funcao: a.funcao, ativo: a.ativo };
    if (temColunas) Object.assign(campos, { vinculo: a.vinculo, cadastro_nome: a.oficial || null });
    const { error } = await sb.from("pessoas").update(campos).eq("id", a.fica);
    if (error) throw new Error(`${a.alvo}: ${error.code === "23505" ? "esse nome já existe na lista" : error.message}`);
    feitos++;
  }
  const ina = plano.inativar.filter((x) => escolhidas.has(`i:${x.id}`)).map((x) => x.id);
  if (ina.length) {
    const { error } = await sb.from("pessoas").update({ ativo: false }).in("id", ina);
    if (error) throw error;
  }
  return { feitos, inativados: ina.length };
}
