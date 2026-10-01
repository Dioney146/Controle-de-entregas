"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { configurado } from "../lib/supabase";
import Presenca, { corDoNome, iniciais } from "./Presenca";

// "Login" sem senha: a pessoa só diz quem é. Serve para mostrar quem está no site
// e em qual célula, e para gravar quem deu checkout / enviou ao histórico.
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

const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function Entrar({ aoEntrar }) {
  const [nome, setNome] = useState("");
  const recentes = ler("nomesRecentes", []);

  function entrar(n) {
    const limpo = String(n || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (limpo.length < 2) return;
    gravar("nomesRecentes", [limpo, ...recentes.filter((x) => x !== limpo)].slice(0, 6));
    aoEntrar(limpo);
  }

  return (
    <div className="login">
      <form className="cartao login-cartao" onSubmit={(e) => { e.preventDefault(); entrar(nome); }}>
        <div className="marca grande">Delly's <span>Controle de Entregas</span></div>
        <label>Quem está usando?
          <input autoFocus placeholder="Digite seu nome" value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} />
        </label>
        {recentes.length > 0 && (
          <div className="recentes">
            {recentes.map((r) => (
              <button type="button" key={r} className="recente" onClick={() => entrar(r)}>
                <span className="avatar" style={{ background: corDoNome(r) }}>{iniciais(r)}</span>{r}
              </button>
            ))}
          </div>
        )}
        <button className="btn primario" disabled={nome.trim().length < 2}>Entrar</button>
        <small className="sub">Sem senha — o nome serve para mostrar quem está no site e quem fez cada alteração.</small>
      </form>
    </div>
  );
}

export default function Casca({ children }) {
  const caminho = usePathname();
  const [nome, setNome] = useState(undefined); // undefined = ainda lendo

  useEffect(() => { setNome(ler("usuarioSite", "") || ""); }, []);

  if (!configurado()) {
    return (
      <div className="login">
        <div className="cartao login-cartao">
          <div className="marca grande">Delly's <span>Controle de Entregas</span></div>
          <div className="alerta erro">
            Falta configurar o Supabase. Na Vercel, vá em <b>Settings → Environment Variables</b> e crie
            <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code>. Depois faça um novo deploy.
          </div>
        </div>
      </div>
    );
  }

  if (nome === undefined) return <div className="carregando-tela">Carregando…</div>;
  if (!nome) return <Entrar aoEntrar={(n) => { gravar("usuarioSite", n); setNome(n); }} />;

  function sair() {
    gravar("usuarioSite", "");
    setNome("");
  }

  return (
    <UsuarioCtx.Provider value={{ email: nome }}>
      <header className="topo nao-imprimir">
        <div className="marca">Delly's <span>Controle de Entregas · AM</span></div>
        <nav>
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} className={caminho === m.href ? "ativo" : ""}>{m.rotulo}</Link>
          ))}
        </nav>
        <Presenca nome={nome} pagina={caminho} />
        <div className="usuario">
          <span className="avatar eu" style={{ background: corDoNome(nome) }} title={nome}>{iniciais(nome)}</span>
          <span className="nome-logado">{nome}</span>
          <button className="btn link" onClick={sair} title="Trocar de usuário">Sair</button>
        </div>
      </header>
      <main className="conteudo">{children}</main>
    </UsuarioCtx.Provider>
  );
}
