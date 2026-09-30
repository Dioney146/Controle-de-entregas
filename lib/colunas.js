"use client";

import { useEffect, useRef } from "react";

// Colunas com largura ajustável, igual ao Excel:
// - arraste a borda direita do cabeçalho para aumentar/diminuir
// - duplo clique na borda ajusta a coluna ao conteúdo (AutoAjuste)
// As larguras ficam salvas neste navegador, por tabela.

let canvas;
function larguraTexto(texto, fonte) {
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = fonte;
  return ctx.measureText(texto || "").width;
}

function larguraConteudo(cel) {
  const input = cel.querySelector("input.campo-ed:not(.hora)");
  if (input) {
    const fonte = getComputedStyle(input).font;
    const extra = input.type === "number" ? 44 : 30; // número tem as setinhas
    return Math.ceil(larguraTexto(input.value || input.placeholder || "", fonte)) + extra;
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

export function useColunas(chave, gatilho) {
  const ref = useRef(null);

  useEffect(() => {
    const tabela = ref.current;
    if (!tabela) return;
    const ths = [...tabela.querySelectorAll("thead tr:first-child > th")];
    if (!ths.length) return;

    const salvas = ler(chave);
    const larg = ths.map(() => 0);

    const aplicar = () => {
      ths.forEach((th, i) => { th.style.width = larg[i] + "px"; });
      tabela.style.tableLayout = "fixed";
      tabela.style.width = larg.reduce((a, b) => a + b, 0) + "px";
    };

    const usarSalvas = salvas && salvas.length === ths.length;
    const medidas = usarSalvas ? null : medirTudo(tabela);
    ths.forEach((th, i) => { larg[i] = usarSalvas ? salvas[i] : medidas[i]; });
    aplicar();

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
          gravar(chave, larg);
        };
        document.addEventListener("mousemove", mover);
        document.addEventListener("mouseup", soltar);
      };
      const duplo = (e) => {
        e.stopPropagation();
        larg[i] = medirTudo(tabela)[i];
        aplicar();
        gravar(chave, larg);
      };
      alca.addEventListener("mousedown", baixo);
      alca.addEventListener("dblclick", duplo);
      limpar.push(() => { alca.removeEventListener("mousedown", baixo); alca.removeEventListener("dblclick", duplo); alca.remove(); });
    });

    return () => limpar.forEach((f) => f());
  }, [chave, gatilho]);

  // volta todas as colunas para o auto ajuste
  function resetar() {
    gravar(chave, null);
    const tabela = ref.current;
    if (!tabela) return;
    const ths = [...tabela.querySelectorAll("thead tr:first-child > th")];
    const larg = medirTudo(tabela);
    ths.forEach((th, i) => { th.style.width = larg[i] + "px"; });
    tabela.style.width = larg.reduce((a, b) => a + b, 0) + "px";
  }

  return [ref, resetar];
}
