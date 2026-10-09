// Validação do nome de entrada (os sites não têm senha: o nome identifica quem fez cada coisa).
// Aceita só nome de pessoa: letras (com acento), espaço, hífen e apóstrofo.
// Recusa números, códigos (ex.: D8325ZC), datas e palavras genéricas (TESTE, PLANILHA, ADMIN...).

const sem = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

const PROIBIDAS = new Set([
  "TESTE", "TESTES", "TESTANDO", "TEST", "TST", "ADMIN", "ADM", "ADMINISTRADOR", "ADMINISTRACAO",
  "USUARIO", "USUARIOS", "USER", "LOGIN", "SENHA", "PLANILHA", "SISTEMA", "SITE", "COMPUTADOR", "PC",
  "NOTEBOOK", "CELULAR", "MAQUINA", "CONVIDADO", "GUEST", "ANONIMO", "NOME", "SEMNOME", "NINGUEM",
  "DELLY", "DELLYS", "PORTARIA", "MONITORAMENTO", "LOGISTICA", "ROTEIRIZACAO", "FATURAMENTO", "EXPEDICAO",
  "OPERADOR", "SUPERVISOR", "MOTORISTA", "ENTREGADOR", "FRETE", "RETORNO", "TRANSFERENCIA", "DEVOLUCAO",
  "XXX", "XX", "ASD", "ASDF", "QWE", "QWERTY", "ABC", "AAA", "OI", "OLA", "EU", "FULANO", "CICLANO", "BELTRANO",
]);

export function normalizarNome(n) {
  return String(n || "").trim().toUpperCase().replace(/\s+/g, " ");
}

// devolve "" se o nome serve; senão, o motivo (para mostrar na tela)
export function erroNome(n) {
  const nome = normalizarNome(n);
  if (nome.length < 3) return "Digite seu nome (pelo menos 3 letras).";
  if (nome.length > 40) return "Nome muito longo.";
  if (/\d/.test(nome)) return "Use seu nome, sem números.";
  if (!/^[A-ZÀ-ÖØ-Ý' -]+$/.test(nome)) return "Use só letras no nome (sem símbolos).";
  const palavras = sem(nome).split(/[ -]+/).filter(Boolean);
  if (!palavras.length) return "Digite seu nome.";
  if (palavras.length > 5) return "Digite só seu nome e sobrenome.";
  if (palavras[0].replace(/'/g, "").length < 3) return "Digite seu primeiro nome completo.";
  if (palavras.some((p) => PROIBIDAS.has(p.replace(/'/g, "")))) return "Esse nome não identifica ninguém. Use seu nome de verdade.";
  if (palavras.some((p) => /(.)\1\1/.test(p))) return "Esse nome não parece válido.";
  if (palavras.some((p) => p.length >= 3 && !/[AEIOUY]/.test(p))) return "Esse nome não parece válido.";
  return "";
}

export const nomeValido = (n) => !erroNome(n);
