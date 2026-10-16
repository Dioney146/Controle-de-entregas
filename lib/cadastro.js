// Cadastro para o GreenMile (GM): liga os nomes usados no site ao cadastro oficial (Winthor × RoadNet).
// Apto no GM = cadastrado no Winthor E no RoadNet com o mesmo nome.

export const normNome = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();

// palavras que não fazem parte do nome da pessoa
const IGNORAR = new Set(["DG", "DIARISTA", "DIARIS", "DIARIST", "DIAR", "CONFERENTE", "AJUDANTE", "DE", "DA", "DO", "DOS", "DAS", "E"]);
const tokens = (n) => normNome(n).split(" ").filter((t) => t && !IGNORAR.has(t));

export const ehDiarista = (nome) => /(^|[^A-Z])DG([^A-Z]|$)|DIARI|(^|[^A-Z])DIAR([^A-Z]|$)/.test(normNome(nome));

// o nome do site "cabe" no nome oficial? 1º nome igual e os demais aparecem na mesma ordem
// (aceita abreviação: "A" casa com "ANTONIO", "SOUZ" com "SOUZA")
export function cabe(curto, oficial) {
  const a = tokens(curto), b = tokens(oficial);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  let j = 1;
  for (const t of a.slice(1)) {
    while (j < b.length && !(b[j] === t || (t.length === 1 && b[j].startsWith(t)) || (t.length >= 4 && b[j].startsWith(t)))) j++;
    if (j >= b.length) return false;
    j++;
  }
  return true;
}

// candidatos do cadastro para um nome do site
export function candidatos(nome, cadastro) {
  const n = normNome(nome).replace(/(^| )(DG|DIARISTA|DIARIS|DIARIST|DIAR|CONFERENTE)( |$)/g, " ").trim();
  const exato = cadastro.filter((c) => [c.nome, c.nome_winthor, c.nome_roadnet].some((x) => x && normNome(x) === n));
  if (exato.length) return exato;
  return cadastro.filter((c) => [c.nome, c.nome_winthor, c.nome_roadnet].some((x) => x && cabe(n, x)));
}

// situação de cada pessoa do site no GM
export const GM = {
  APTO: { rot: "Apto", classe: "gm-ok", dica: "No Winthor e no RoadNet com o mesmo nome" },
  GRAFIA: { rot: "Nome diferente", classe: "gm-aviso", dica: "Está nos dois sistemas, mas com grafia diferente — igualar" },
  FALTA_RN: { rot: "Falta RoadNet", classe: "gm-pend", dica: "Só no Winthor — cadastrar no RoadNet" },
  FALTA_WT: { rot: "Falta Winthor", classe: "gm-pend", dica: "Só no RoadNet — cadastrar no Winthor (rotina 929)" },
  SEM: { rot: "Sem cadastro", classe: "gm-sem", dica: "Não está no Winthor nem no RoadNet" },
  ESCOLHER: { rot: "Ligar ao cadastro", classe: "gm-escolher", dica: "Mais de uma pessoa possível no cadastro — escolha qual é" },
};

export function situacaoGM(c) {
  if (!c) return GM.SEM;
  if (c.situacao === "OK") return GM.APTO;
  if (c.situacao === "GRAFIA" || c.situacao === "POSSIVEL") return GM.GRAFIA;
  if (c.situacao === "SO_WINTHOR") return GM.FALTA_RN;
  if (c.situacao === "SO_ROADNET") return GM.FALTA_WT;
  return GM.SEM;
}

// liga cada pessoa ao cadastro: 1º a ligação escolhida na tela; senão, automática quando só há 1 candidato
// (nome com uma palavra só, ex. "TIAGO", não liga sozinho: há muitos Tiagos)
export function ligarPessoas(pessoas, cadastro) {
  const porNome = new Map(cadastro.map((c) => [normNome(c.nome), c]));
  return pessoas.map((p) => {
    if (p.cadastro_nome) {
      const c = porNome.get(normNome(p.cadastro_nome)) || null;
      return { ...p, cadastro: c, ligacao: c ? "manual" : "perdida", cands: [], gm: situacaoGM(c) };
    }
    const cands = candidatos(p.nome, cadastro);
    const umaPalavra = tokens(p.nome).length < 2;
    if (cands.length === 1 && (!umaPalavra || normNome(cands[0].nome) === normNome(p.nome))) {
      return { ...p, cadastro: cands[0], ligacao: "auto", cands, gm: situacaoGM(cands[0]) };
    }
    return { ...p, cadastro: null, ligacao: "", cands, gm: cands.length ? GM.ESCOLHER : GM.SEM };
  });
}
