import { createClient } from "@supabase/supabase-js";

let client = null;
let usuarioAtual = "";

export function configurado() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// o nome vai num cabeçalho (sem acentos) para o banco registrar quem fez cada alteração (log)
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "");

function criar() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { "x-usuario": semAcento(usuarioAtual) || "DESCONHECIDO" } },
    // "worker": mantém a conexão de tempo real viva mesmo com a aba em segundo plano
    realtime: { worker: true },
  });
}

// Define quem está usando o site (chamado no "login" sem senha)
export function definirUsuario(nome) {
  if (nome === usuarioAtual && client) return;
  usuarioAtual = nome || "";
  if (client) { try { client.removeAllChannels(); } catch {} }
  client = criar();
}

// Cliente único do Supabase (só é criado no navegador, quando as variáveis existem)
export function sb() {
  if (!client) client = criar();
  return client;
}

// Busca todas as linhas de uma consulta, contornando o limite de 1000 do Supabase
export async function buscarTudo(montarConsulta, tamanho = 1000) {
  let todas = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await montarConsulta().range(de, de + tamanho - 1);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < tamanho) break;
  }
  return todas;
}
