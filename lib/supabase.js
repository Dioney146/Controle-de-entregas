import { createClient } from "@supabase/supabase-js";

let client = null;

export function configurado() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// Cliente único do Supabase (só é criado no navegador, quando as variáveis existem)
export function sb() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
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
