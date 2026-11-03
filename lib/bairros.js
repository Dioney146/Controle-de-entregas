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

const tira = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// acha o bairro da lista pelo nome digitado (sem acento / maiúsculas)
export const bairroDaLista = (b) => BAIRROS_MANAUS.find((x) => tira(x) === tira(b)) || "";
