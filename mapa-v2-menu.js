/* ============================================================
   mapa-v2-menu.js — junta as duas barras do topo numa só.

   O MAPA tem o cabeçalho da rede (.mg-header) e, logo abaixo, a barra
   própria de cada tela — com nome diferente em cada uma: modal-tabs,
   cfg-tabs, barra-seg, subtabs, seg, tab-bar...

   Em vez de reescrever o HTML de 13 páginas, este script MOVE o grupo de
   abas para dentro do cabeçalho. Mover preserva os mesmos nós no DOM:
   ouvintes de clique, referências guardadas em variáveis e consultas por
   id continuam valendo. Nada é recriado nem removido.

   A escolha do grupo é conservadora de propósito. Numa primeira versão o
   critério era "o maior aglomerado de botões", e no index.html isso pegou
   a grade de módulos inteira e jogou dentro do cabeçalho. Agora o
   candidato precisa parecer uma barra: estar colada no topo, ser baixa,
   caber numa linha e ter poucos controles. Não achando nada assim, o
   script desiste e a página fica exatamente como estava.
   ============================================================ */
(function () {
  "use strict";

  var SELETORES = [
    ".modal-tabs", ".cfg-tabs", ".barra-seg", ".subtabs",
    ".tab-bar", ".seg", ".nav-tabs", ".tabs"
  ];

  var ALTURA_MAX = 92;      // barra de abas não passa disso
  var DISTANCIA_MAX = 190;  // precisa estar colada no cabeçalho
  var CONTROLES_MIN = 2;
  var CONTROLES_MAX = 9;

  function pareceBarra(el, limiteCabecalho) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 10) return false;          // invisível
    if (r.height > ALTURA_MAX) return false;                  // alto demais
    if (r.top > limiteCabecalho + DISTANCIA_MAX) return false; // longe do topo
    var n = el.querySelectorAll("button, a").length;
    if (n < CONTROLES_MIN || n > CONTROLES_MAX) return false;
    // uma barra tem os controles lado a lado, não empilhados
    var filhos = el.querySelectorAll("button, a");
    if (filhos.length >= 2) {
      var t0 = filhos[0].getBoundingClientRect().top;
      var t1 = filhos[filhos.length - 1].getBoundingClientRect().top;
      if (Math.abs(t1 - t0) > 26) return false;
    }
    return true;
  }

  function achar(cabecalho) {
    var limite = cabecalho.getBoundingClientRect().bottom;

    // 1. grupos com nome conhecido
    for (var i = 0; i < SELETORES.length; i++) {
      var lista = document.querySelectorAll(SELETORES[i]);
      for (var k = 0; k < lista.length; k++) {
        if (cabecalho.contains(lista[k])) continue;
        if (pareceBarra(lista[k], limite)) return lista[k];
      }
    }

    // 2. os primeiros irmãos depois do cabeçalho, e o que houver dentro deles
    var irmao = cabecalho.nextElementSibling;
    for (var passo = 0; irmao && passo < 3; passo++, irmao = irmao.nextElementSibling) {
      if (irmao.tagName === "SCRIPT" || irmao.id === "ceu") continue;
      if (irmao.classList && irmao.classList.contains("v2-faixa")) continue;
      if (pareceBarra(irmao, limite)) return irmao;
      var dentro = irmao.querySelectorAll("div, nav, ul");
      for (var j = 0; j < dentro.length; j++) {
        if (pareceBarra(dentro[j], limite)) return dentro[j];
      }
    }
    return null;
  }

  function juntar() {
    try {
      var cabecalho = document.querySelector(".mg-header");
      if (!cabecalho || cabecalho.dataset.v2Junto === "1") return;

      var grupo = achar(cabecalho);
      if (!grupo || grupo.contains(cabecalho)) return;

      var barra = grupo.parentElement;
      var alvo = cabecalho.querySelector(".mg-spacer");
      grupo.classList.add("v2-subnav");
      if (alvo) cabecalho.insertBefore(grupo, alvo);
      else cabecalho.appendChild(grupo);

      // O que sobrou: escondido só se não restou nada visível. Escondido, e
      // não removido — código da página pode consultar o elemento depois.
      if (barra && barra !== document.body && !cabecalho.contains(barra)) {
        var controles = barra.querySelectorAll("button, a, input, select").length;
        var texto = (barra.textContent || "").replace(/\s+/g, "");
        if (!controles && texto.length < 40) barra.classList.add("v2-barra-vazia");
        else barra.classList.add("v2-barra-restante");
      }

      cabecalho.classList.add("v2-cabecalho-unico");
      cabecalho.dataset.v2Junto = "1";
    } catch (e) {
      /* silêncio: sem a fusão a página segue válida */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", juntar);
  } else {
    juntar();
  }
  // várias telas montam a própria barra só depois de carregar os dados
  window.setTimeout(juntar, 700);
  window.setTimeout(juntar, 2200);
  window.setTimeout(juntar, 5000);
})();
