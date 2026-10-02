/** @type {import('next').NextConfig} */
// Aceita as variáveis com ou sem o prefixo NEXT_PUBLIC_ (na Vercel pode usar SUPABASE_URL e SUPABASE_ANON_KEY)
module.exports = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\/+$/, ""),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim(),
    // endereço do site de Transferências (link no menu)
    NEXT_PUBLIC_URL_TRANSFERENCIAS: (process.env.NEXT_PUBLIC_URL_TRANSFERENCIAS || process.env.URL_TRANSFERENCIAS || "").trim(),
  },
};
