"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sb, configurado } from "../lib/supabase";

const UsuarioCtx = createContext(null);
export const useUsuario = () => useContext(UsuarioCtx);

const MENU = [
  { href: "/", rotulo: "Programação" },
  { href: "/frete", rotulo: "Frete / Saídas" },
  { href: "/retorno", rotulo: "Retorno" },
  { href: "/historico", rotulo: "Histórico" },
  { href: "/veiculos", rotulo: "Veículos" },
];

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: senha });
    setCarregando(false);
    if (error) setErro("E-mail ou senha inválidos.");
  }

  return (
    <div className="login">
      <form onSubmit={entrar} className="cartao login-cartao">
        <div className="marca grande">Delly's <span>Controle de Entregas</span></div>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>
        {erro && <div className="alerta erro">{erro}</div>}
        <button className="btn primario" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
      </form>
    </div>
  );
}

export default function Casca({ children }) {
  const caminho = usePathname();
  const [sessao, setSessao] = useState(undefined);

  useEffect(() => {
    if (!configurado()) return;
    sb().auth.getSession().then(({ data }) => setSessao(data.session));
    const { data: sub } = sb().auth.onAuthStateChange((_ev, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

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

  if (sessao === undefined) return <div className="carregando-tela">Carregando…</div>;
  if (!sessao) return <Login />;

  const email = sessao.user?.email || "";

  return (
    <UsuarioCtx.Provider value={{ email }}>
      <header className="topo nao-imprimir">
        <div className="marca">Delly's <span>Controle de Entregas · AM</span></div>
        <nav>
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} className={caminho === m.href ? "ativo" : ""}>{m.rotulo}</Link>
          ))}
        </nav>
        <div className="usuario">
          <span>{email}</span>
          <button className="btn link" onClick={() => sb().auth.signOut()}>Sair</button>
        </div>
      </header>
      <main className="conteudo">{children}</main>
    </UsuarioCtx.Provider>
  );
}
