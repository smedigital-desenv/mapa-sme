/* ============================================================
   mapa-v2-ceu.js — o céu das telas do MAPA.

   Aqui NÃO há animação, de propósito. O portal usa um campo com riscos
   de luz atravessando a tela, que é bom numa página de entrada; numa
   tela de trabalho, movimento atrás de tabela disputa a atenção com o
   dado e atrapalha a leitura. Este arquivo desenha uma vez só e
   redesenha apenas quando a janela muda de tamanho. Sem laço de
   animação, sem consumo contínuo de processador — o que também ajuda
   nas máquinas mais antigas das escolas.

   ⚠️ O BRILHO TEM TETO MEDIDO, e ele é o motivo de o código ser mais do
   que um laço de pontos aleatórios. Um ponto atrás de texto clareia o
   fundo daquele pedaço e derruba o contraste. Medido sobre o fundo
   #14232F, com a estrela em #CEECFF:

     · legenda   (--texto-2 #A3AFBB) aguenta até alfa 0,16 e fica em 4,57:1
     · terciário (--texto-3 #95A2AF) aguenta até alfa 0,11 e fica em 4,56:1

   O terciário é quem pinta rótulo de filtro e cabeçalho de tabela, então
   ele é o teto que vale: DENTRO da coluna de conteúdo nenhuma estrela
   passa de 0,10. Fora da coluna — a margem lateral, que é área vazia de
   verdade — o teto sobe e as estrelas ganham halo, que é o que faz o
   fundo parecer céu em vez de chuvisco.

   ⚠️ Em tela estreita não existe margem, e a conta devolve o teto baixo
   para a tela inteira sozinha. Não "simplifique" tirando o cálculo de
   folga: é ele que garante que no notebook da escola o texto continue
   legível, e nenhuma auditoria automática pega isso — o canvas fica
   ATRÁS do conteúdo, não é fundo herdado, e some do cálculo de contraste.
   ============================================================ */
(function () {
  "use strict";

  var cv = document.getElementById("ceu");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  /* ⚠️ A largura da coluna é MEDIDA, não cravada. Havia 1240 aqui — o valor
     da maioria das telas —, mas Relatórios monta 1312px de layout, e a faixa
     que a conta considerava "margem vazia" caía em cima do conteúdo dele.
     Estrela clara atrás de texto é exatamente o que este arquivo existe para
     evitar. O piso de 1240 cobre a tela que ainda não renderizou. */
  var SELETORES = ".page,.container,.container-fluid,.layout-wrapper,main,.be-page";
  function larguraDaColuna() {
    var maior = 1240;
    var els = document.querySelectorAll(SELETORES);
    for (var i = 0; i < els.length; i++) {
      var w = els[i].getBoundingClientRect().width;
      if (w > maior) maior = w;
    }
    return maior;
  }
  var TETO_TEXTO = 0.10;  // sob a coluna: abaixo do limite medido de 0,11
  var TETO_LIVRE = 0.42;  // na margem vazia
  var COR = "206,236,255";
  var COR_ACENTO = "120,214,242";   // uma minoria puxa para o acento da pele

  /* Quanto aquele ponto está "livre" de conteúdo: 0 dentro da coluna,
     1 bem fora dela. A transição é suave para não aparecer uma borda
     vertical de brilho no meio da tela. */
  function folga(x, L, COLUNA) {
    var meia = Math.max(0, (L - COLUNA) / 2);
    if (meia <= 0) return 0;                    // tela estreita: sem margem
    var borda = (L - COLUNA) / 2;               // onde a coluna começa
    var d = (x < L / 2) ? (borda - x) : (x - (L - borda));
    if (d <= 0) return 0;
    return Math.min(1, d / Math.max(60, meia));
  }

  function desenhar() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var L = cv.clientWidth;
    var A = cv.clientHeight;
    if (!L || !A) return;

    cv.width = Math.round(L * dpr);
    cv.height = Math.round(A * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L, A);

    /* ⚠️ Adensar é seguro; clarear não é. O teto de 0,10 vale POR ESTRELA, e
       uma letra cobre uma ou duas — então mais pontos não pioram o contraste
       de nenhuma delas, enquanto mais brilho pioraria o de todas. Aumentado
       de 4500 para 3200 (~75% mais estrelas) para maior presença visual. */
    var n = Math.max(160, Math.min(640, Math.round(L * A / 3200)));
    var COLUNA = larguraDaColuna();

    for (var i = 0; i < n; i++) {
      var x = Math.random() * L;
      var y = Math.random() * A;
      var livre = folga(x, L, COLUNA);

      /* Distribuição de potência: reduzido de 2.6 para 2.1 para maior presença
         visual de estrelas de médio brilho. Ainda mantém muitos pontos miúdos
         com poucas grandes se destacando — a forma de parecer céu. */
      var q = Math.pow(Math.random(), 2.1);
      var teto = TETO_TEXTO + (TETO_LIVRE - TETO_TEXTO) * livre;
      var a = 0.050 + q * (teto - 0.050);
      /* Dentro da coluna a estrela cresce em vez de clarear: área maior no
         mesmo alfa lê melhor do que um ponto minúsculo e apagado, e não mexe
         no contraste, que depende só do alfa. Tamanho aumentado para maior
         presença visual. */
      var r = 0.5 + q * (livre > 0.5 ? 1.8 : 1.3);
      var cor = (Math.random() < 0.18) ? COR_ACENTO : COR;

      // halo nas estrelas médias e grandes fora da coluna (reduzido de 0.72)
      if (q > 0.60 && livre > 0.5) {
        var g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
        g.addColorStop(0, "rgba(" + cor + "," + (a * 0.55).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + cor + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 6, 0, 6.283);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.283);
      ctx.fillStyle = "rgba(" + cor + "," + a.toFixed(3) + ")";
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
