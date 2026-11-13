// Lista oficial dos bairros de Manaus (IMPLURB/Prefeitura de Manaus)
export const BAIRROS_MANAUS = [
  "Adrianópolis", "Aleixo", "Alvorada", "Armando Mendes", "Bairro da Paz",
  "Betânia", "Cachoeirinha", "Centro", "Chapada", "Cidade de Deus",
  "Cidade Nova", "Colônia Antônio Aleixo", "Colônia Oliveira Machado",
  "Colônia Santo Antônio", "Colônia Terra Nova", "Compensa", "Coroado",
  "Crespo", "Distrito Industrial I", "Distrito Industrial II", "Dom Pedro",
  "Educandos", "Flores", "Gilberto Mestrinho", "Glória", "Japiim",
  "Jorge Teixeira", "Lago Azul", "Lírio do Vale", "Mauazinho",
  "Monte das Oliveiras", "Morro da Liberdade", "Nossa Senhora das Graças",
  "Nossa Senhora de Aparecida", "Nova Cidade", "Nova Esperança",
  "Novo Aleixo", "Novo Israel", "Parque 10 de Novembro", "Petrópolis",
  "Planalto", "Ponta Negra", "Praça 14 de Janeiro", "Presidente Vargas",
  "Puraquequara", "Raiz", "Redenção", "Santa Etelvina", "Santa Luzia",
  "Santo Agostinho", "Santo Antônio", "São Francisco", "São Geraldo",
  "São Jorge", "São José Operário", "São Lázaro", "São Raimundo",
  "Tancredo Neves", "Tarumã", "Tarumã-Açu", "Vila Buriti", "Vila da Prata",
  "Zumbi dos Palmares",
];

// ---------- conversão do nome da base para o bairro da lista (igual ao site de Reentregas) ----------
const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// abreviações comuns na base: "N SRA", "STO", "COL", "OLIV", "PARQUE DEZ", "CIDADE D DEUS"...
const ABREV = [
  [/\bN S(RA)?\b|\bNS\b|\bN SENHORA\b|\bNOSSA SRA\b/g, "NOSSA SENHORA"], [/\bSTO\b/g, "SANTO"], [/\bSTA\b/g, "SANTA"],
  [/\bCOL\b/g, "COLONIA"], [/\bOLIV\b/g, "OLIVEIRA"], [/\bDISTRIT\b|\bDIST\b/g, "DISTRITO"], [/\bIND\b/g, "INDUSTRIAL"],
  [/\bPARQUE DEZ\b/g, "PARQUE 10"], [/\bPCA\b/g, "PRACA"], [/\bD\b/g, "DE"], [/\bTEIXEIIRA\b/g, "TEIXEIRA"], [/\bCACHOERINHA\b/g, "CACHOEIRINHA"],
];
// nomes da base que não batem com a lista, mas são o mesmo bairro
const APELIDOS = {
  "APARECIDA": "Nossa Senhora de Aparecida", "NOSSA SENHORA APARECIDA": "Nossa Senhora de Aparecida",
  "SAO JOSE": "São José Operário", "LIBERDADE": "Morro da Liberdade", "PALMARES": "Zumbi dos Palmares",
  "PARQUE 10": "Parque 10 de Novembro", "DA PAZ": "Bairro da Paz", "PAZ": "Bairro da Paz", "TARUMA ACU": "Tarumã-Açu",
  "DISTRITO INDUSTRIAL": "Distrito Industrial I", "DISTRITO INDUSTRIAL 1": "Distrito Industrial I", "DISTRITO INDUSTRIAL 2": "Distrito Industrial II",
};
const LISTA = BAIRROS_MANAUS.map((b) => [semAcento(b), b]);
const tiraNumero = (t) => t.replace(/\b(I{1,3}|IV|V|\d+)\b/g, "").replace(/\b(CJ|CONJ|CONJUNTO|BAIRRO|NUCLEO)\b/g, "").replace(/\s+/g, " ").trim();
// "JAPIIM" / "japiim ii" / "N SRA DAS GRACAS" / "COL STO ANTONIO" -> bairro da lista oficial ("" se não achar)
export function bairroOficial(bruto) {
  let k = semAcento(bruto);
  if (!k) return "";
  k = k.replace(/([A-Z])(\d)/g, "$1 $2"); // "JAPIIM1" -> "JAPIIM 1"
  for (const [re, por] of ABREV) k = k.replace(re, por);
  k = k.replace(/\s+/g, " ").trim();
  const igual = LISTA.find(([x]) => x === k);
  if (igual) return igual[1];
  if (APELIDOS[k]) return APELIDOS[k];
  const k2 = tiraNumero(k);
  if (APELIDOS[k2]) return APELIDOS[k2];
  const parecido = LISTA.find(([x]) => tiraNumero(x) === k2) || LISTA.find(([x]) => x.length >= 5 && (k.startsWith(x + " ") || k2 === x));
  if (parecido) return parecido[1];
  // "INA - CIDADE NOVA 1" -> Cidade Nova (o nome da lista aparece inteiro no texto; vale o mais comprido)
  const dentro = LISTA.filter(([x]) => x.length >= 6 && ` ${k} `.includes(` ${x} `)).sort((a, b) => b[0].length - a[0].length)[0];
  return dentro ? dentro[1] : "";
}

// "TERRA PRETA" -> "Terra Preta" (bairro fora da lista, do jeito que veio da base)
const MINUSC = new Set(["da", "de", "do", "das", "dos", "e"]);
export const nomeBonito = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ")
  .split(" ").map((p, i) => (i && MINUSC.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
// bairro vinculado à nota: o da lista quando bate; senão, o que veio da base
export const bairroDaNota = (b) => bairroOficial(b) || nomeBonito(b);

// compatibilidade: nome antigo usado nas Notas agendadas
export const bairroDaLista = (b) => bairroOficial(b);
