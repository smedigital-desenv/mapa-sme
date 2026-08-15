/* ============================================================
   mapa-v2-ceu.js — fundo discreto das telas do MAPA.

   Aqui NÃO há animação, de propósito. O portal usa um campo com riscos
   de luz atravessando a tela, que é bom numa página de entrada; numa
   tela de trabalho, movimento atrás de tabela disputa a atenção com o
   dado e atrapalha a leitura. Este arquivo desenha um campo de pontos
   parado, uma vez só, e redesenha apenas quando a janela muda de
   tamanho. Sem laço de animação, sem consumo contínuo de processador —
   o que também ajuda nas máquinas mais antigas das escolas.
   ============================================================ */
(function () {
  "use strict";

  var cv = document.getElementById("ceu");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  function desenhar() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var L = cv.clientWidth;
    var A = cv.clientHeight;
    if (!L || !A) return;

    cv.width = Math.round(L * dpr);
    cv.height = Math.round(A * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L, A);

    // densidade baixa e opacidade discreta: presença, não protagonismo
    var n = Math.max(24, Math.min(70, Math.round(L * A / 26000)));
    for (var i = 0; i < n; i++) {
      var x = Math.random() * L;
      var y = Math.random() * A;
      var r = 0.4 + Math.random() * 0.9;
      var a = 0.07 + Math.random() * 0.16;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.283);
      ctx.fillStyle = "rgba(206,236,255," + a.toFixed(3) + ")";
      ctx.fill();
    }
  }

  desenhar();

  var espera = null;
  window.addEventListener("resize", function () {
    clearTimeout(espera);
    espera = setTimeout(desenhar, 200);
  });
})();
