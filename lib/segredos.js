// Configuração do site. Jeito mais fácil: copiar TODO o "Secrets" do Streamlit e colar
// numa única variável na Vercel chamada STREAMLIT_SECRETS.
// (Também aceita as variáveis separadas: SPREADSHEET_ID, GCP_CLIENT_EMAIL, GCP_PRIVATE_KEY,
//  GCP_SERVICE_ACCOUNT, LOGIN_USUARIOS, LOGIN_HASHES — elas têm prioridade.)

function desescapar(s) {
  return s.replace(/\\(["\\nrt])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" }[c]));
}

// lê uma string do TOML: chave = "..." | '...' | """...""" | '''...'''
function tomlTexto(toml, chave) {
  const re = new RegExp(`^\\s*${chave}\\s*=\\s*("""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"(?:[^"\\\\\\n]|\\\\.)*"|'[^'\\n]*')`, "m");
  const m = toml.match(re);
  if (!m) return "";
  const v = m[1];
  if (v.startsWith('"""')) return desescapar(v.slice(3, -3).replace(/^\n/, ""));
  if (v.startsWith("'''")) return v.slice(3, -3).replace(/^\n/, "");
  if (v.startsWith('"')) return desescapar(v.slice(1, -1));
  return v.slice(1, -1);
}

// lê uma lista do TOML: chave = ["a", "b"]
function tomlLista(toml, chave) {
  const m = toml.match(new RegExp(`^\\s*${chave}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m"));
  if (!m) return [];
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((x) => (x[1] !== undefined ? desescapar(x[1]) : x[2]).trim());
}

// lista em variável separada: dioney,thompson | ["dioney","thompson"] | um por linha
function lista(v) {
  const s = String(v || "").trim();
  if (!s) return [];
  try { const j = JSON.parse(s); if (Array.isArray(j)) return j.map((x) => String(x).trim()); } catch {}
  return s.replace(/[\[\]"']/g, "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

let cache = null;
export function segredos() {
  if (cache) return cache;
  const toml = String(process.env.STREAMLIT_SECRETS || "");
  let conta = {};
  if (process.env.GCP_SERVICE_ACCOUNT) {
    try { conta = JSON.parse(process.env.GCP_SERVICE_ACCOUNT); } catch { throw new Error("GCP_SERVICE_ACCOUNT não é um JSON válido."); }
  }
  const chave = process.env.GCP_PRIVATE_KEY || conta.private_key || tomlTexto(toml, "private_key");
  cache = {
    planilha: (process.env.SPREADSHEET_ID || tomlTexto(toml, "spreadsheet_id")).trim(),
    email: (process.env.GCP_CLIENT_EMAIL || conta.client_email || tomlTexto(toml, "client_email")).trim(),
    chave: String(chave).trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n"),
    usuarios: (process.env.LOGIN_USUARIOS ? lista(process.env.LOGIN_USUARIOS) : tomlLista(toml, "usernames")).map((u) => u.toLowerCase()),
    hashes: (process.env.LOGIN_HASHES ? lista(process.env.LOGIN_HASHES) : tomlLista(toml, "password_hashes")).map((h) => h.toLowerCase()),
  };
  return cache;
}
