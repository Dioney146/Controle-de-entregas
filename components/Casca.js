"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { configurado } from "../lib/supabase";

// Sem login por enquanto: o "usuário" é só o nome digitado no topo (fica salvo neste navegador)
const UsuarioCtx = createContext({ email: "" });
export const useUsuario = () => useContext(UsuarioCtx);

const MENU = [
  { href: "/", rotulo: "Programação" },
  { href: "/frete", rotulo: "Frete / Saídas" },
  { href: "/retorno", rotulo: "Retorno" },
  { href: "/historico", rotulo: "Histórico" },
  { href: "/veiculos", rotulo: "Veículos" },
  { href: "/pessoas", rotulo: "Motoristas / Entregadores" },
];

function lerNome() {
  try { return localStorage.getItem("nomeUsuario") || ""; } catch { return ""; }
}
function salvarNome(n) {
  try { localStorage.setItem("nomeUsuario", n); } catch {}
}

export default function Casca({ children }) {
  const caminho = usePathname();
  const [nome, setNome] = useState("");

  useEffect(() => { setNome(lerNome()); }, []);

  if (!configurado()) {
    return (
      <div className="login">
        <div className="cartao login-cartao">
          <div className="marca grande">Delly's <span>Controle de Entregas</span></div>
          <div className="alerta erro">
            Falta configurar o Supabase. Na Vercel, vá em <b>Settings → Environment Variables</b> e crie
            <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Depois faça um novo deploy.
          </div>
        </div>
      </div>
    );
  }

  return (
    <UsuarioCtx.Provider value={{ email: nome.trim().toUpperCase() }}>
      <header className="topo nao-imprimir">
        <div className="marca">Delly's <span>Controle de Entregas · AM</span></div>
        <nav>
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} className={caminho === m.href ? "ativo" : ""}>{m.rotulo}</Link>
          ))}
        </nav>
        <div className="usuario">
          <input
            className="nome-usuario"
            placeholder="Seu nome"
            title="Aparece no checkout do retorno"
            value={nome}
            onChange={(e) => { setNome(e.target.value); salvarNome(e.target.value); }}
          />
        </div>
      </header>
      <main className="conteudo">{children}</main>
    </UsuarioCtx.Provider>
  );
}
