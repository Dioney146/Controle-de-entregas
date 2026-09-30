"use client";

import { useEffect, useRef, useState } from "react";

// Colunas com largura ajustável, igual ao Excel:
// - arraste a borda direita do cabeçalho para aumentar/diminuir
// - duplo clique na borda ajusta a coluna ao conteúdo (AutoAjuste)
// - por padrão a tabela preenche toda a largura da tela (colunas crescem na mesma proporção)
// As larguras ficam salvas neste navegador, por tabela.

let canvas;
function larguraTexto(texto, fonte) {
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = fonte;
  return ctx.measureText(texto || "").width;
}

function larguraConteudo(cel) {
  if (cel.tagName === "TH") {
    // cabeçalho: texto (em maiúsculas) + espaço do botão de filtro
    const est = getComputedStyle(cel);
    const rot = cel.querySelector(".th-rotulo") || cel;
    const texto = (rot.textContent || "").toUpperCase();
    const w = larguraTexto(texto, `${est.fontWeight} ${est.fontSize} ${est.fontFamily}`) + texto.length * 0.4; // letter-spacing
    return Math.ceil(w) + (cel.classList.contains("th-filtro") ? 34 : 16);
  }
  const input = cel.querySelector("input.campo-ed:not(.hora)");
  if (input) {
    const fonte = getComputedStyle(input).font;
    const extra = input.type === "number" ? 44 : 30; // número tem as setinhas
    const w = Math.ceil(larguraTexto(input.value || input.placeholder || "", fonte)) + extra;
    // colunas de nome (motorista/entregador) já nascem com espaço para digitar
    return input.getAttribute("list") ? Math.max(w, 200) : w;
  }
  return cel.scrollWidth + 8;
}

// Mede a largura natural de todas as colunas (como o AutoAjuste do Excel)
function medirTudo(tabela) {
  const ths = [...tabela.querySelectorAll("thead tr:first-child > th")];
  const antes = { layout: tabela.style.tableLayout, width: tabela.style.width, ths: ths.map((th) => th.style.width) };
  tabela.classList.add("medindo");
  tabela.style.tableLayout = "auto";
  tabela.style.width = "max-content";
  ths.forEach((th) => { th.style.width = ""; });
  // cada célula é atribuída à sua coluna real (respeitando células mescladas / colSpan)
  const porColuna = ths.map(() => []);
  tabela.querySelectorAll("tr").forEach((tr) => {
    let col = 0;
    [...tr.children].forEach((c) => {
      if (c.colSpan === 1 && porColuna[col]) porColuna[col].push(c);
      col += c.colSpan || 1;
    });
  });
  const res = porColuna.map((cels) => Math.min(480, Math.max(36, ...cels.map(larguraConteudo))));
  tabela.classList.remove("medindo");
  tabela.style.tableLayout = antes.layout;
  tabela.style.width = antes.width;
  ths.forEach((th, i) => { th.style.width = antes.ths[i]; });
  return res;
}

function ler(chave) {
  try { return JSON.parse(localStorage.getItem("larguras:" + chave) || "null"); } catch { return null; }
}
function gravar(chave, v) {
  try {
    if (v) localStorage.setItem("larguras:" + chave, JSON.stringify(v));
    else localStorage.removeItem("larguras:" + chave);
  } catch {}
}

// Estica as colunas proporcionalmente para ocupar toda a largura disponível
function preencher(base, largura) {
  const total = base.reduce((a, b) => a + b, 0);
  if (!largura || total >= largura) return [...base];
  const fator = largura / total;
  const res = base.map((w) => Math.floor(w * fator));
  res[res.length - 1] += largura - res.reduce((a, b) => a + b, 0);
  return res;
}

export function useColunas(chave, gatilho) {
  const ref = useRef(null);
  const [reset, setReset] = useState(0);

  useEffect(() => {
    const tabela = ref.current;
    if (!tabela) return;
    const ths = [...tabela.querySelectorAll("thead tr:first-child > th")];
    if (!ths.length) return;

    const salvas = ler(chave);
    const disponivel = () => Math.max(0, (tabela.parentElement?.clientWidth || 0) - 1);

    const aplicar = () => {
      ths.forEach((th, i) => { th.style.width = larg[i] + "px"; });
      tabela.style.tableLayout = "fixed";
      tabela.style.width = larg.reduce((a, b) => a + b, 0) + "px";
    };

    const usarSalvas = salvas && salvas.length === ths.length;
    let base = usarSalvas ? [...salvas] : medirTudo(tabela); // larguras "reais" (sem esticar)
    let larg = preencher(base, disponivel());                 // larguras mostradas (esticadas até a borda)
    aplicar();

    // se a janela mudar de tamanho, estica de novo
    const aoRedimensionar = () => { larg = preencher(base, disponivel()); aplicar(); };
    window.addEventListener("resize", aoRedimensionar);

    // alças de arraste
    const limpar = [];
    ths.forEach((th, i) => {
      th.querySelectorAll(".alca-col").forEach((a) => a.remove());
      const alca = document.createElement("div");
      alca.className = "alca-col";
      alca.title = "Arraste para ajustar · duplo clique = auto ajuste";
      th.appendChild(alca);

      const baixo = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        const w0 = larg[i];
        alca.classList.add("ativa");
        const mover = (ev) => { larg[i] = Math.max(30, Math.round(w0 + ev.clientX - x0)); aplicar(); };
        const soltar = () => {
          alca.classList.remove("ativa");
          document.removeEventListener("mousemove", mover);
          document.removeEventListener("mouseup", soltar);
          base = [...larg];
          gravar(chave, base);
        };
        document.addEventListener("mousemove", mover);
        document.addEventListener("mouseup", soltar);
      };
      const duplo = (e) => {
        e.stopPropagation();
        larg[i] = medirTudo(tabela)[i];
        aplicar();
        base = [...larg];
        gravar(chave, base);
      };
      alca.addEventListener("mousedown", baixo);
      alca.addEventListener("dblclick", duplo);
      limpar.push(() => { alca.removeEventListener("mousedown", baixo); alca.removeEventListener("dblclick", duplo); alca.remove(); });
    });

    return () => { window.removeEventListener("resize", aoRedimensionar); limpar.forEach((f) => f()); };
  }, [chave, gatilho, reset]);

  // volta todas as colunas para o auto ajuste (preenchendo a tela)
  function resetar() {
    gravar(chave, null);
    setReset((n) => n + 1);
  }

  return [ref, resetar];
}
