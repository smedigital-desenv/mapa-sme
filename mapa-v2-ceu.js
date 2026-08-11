/* ============================================================
   sme-ceu.js — campo de estrelas e riscos de luz do fundo.
   Use junto do sme-ui.css:
     <canvas id="ceu" aria-hidden="true"></canvas>
     <script src=".../sme-ceu.js" defer></script>
   Sem dependências. Para quando a aba perde foco e desenha um
   quadro parado se a pessoa pediu menos movimento.
   ============================================================ */
/* ============================================================
   Campo de estrelas e riscos de luz — canvas atrás de tudo.
   Substitui o risco único em CSS. Para quando a aba sai de foco,
   e desenha um quadro parado se a pessoa pediu menos movimento.
   ============================================================ */
(function () {
  "use strict";
  var cv = document.getElementById('ceu');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var L = 0, A = 0, pontos = [], riscos = [], quadro = 0, raf = null;

  function dimensionar() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    L = cv.clientWidth; A = cv.clientHeight;
    cv.width = Math.round(L * dpr);
    cv.height = Math.round(A * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    semear();
  }

  function semear() {
    // densidade proporcional à área, com teto para não pesar em máquina antiga
    var n = Math.max(40, Math.min(150, Math.round(L * A / 11000)));
    pontos = [];
    for (var i = 0; i < n; i++) {
      pontos.push({
        x: Math.random() * L,
        y: Math.random() * A,
        r: 0.4 + Math.random() * 1.5,
        a: 0.14 + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 0.05,
        vy: -0.015 - Math.random() * 0.055,
        f: Math.random() * 6.283,
        vf: 0.004 + Math.random() * 0.013
      });
    }
  }

  function novoRisco() {
    var desce = Math.random() < 0.72;
    var grau = desce ? (4 + Math.random() * 10) : -(3 + Math.random() * 8);
    riscos.push({
      ang: grau * Math.PI / 180,
      x: -240,
      y: A * (0.04 + Math.random() * 0.78),
      v: 1.6 + Math.random() * 3.4,
      comp: 130 + Math.random() * 200,
      esp: 0.7 + Math.random() * 1.3,
      a: 0.30 + Math.random() * 0.5
    });
  }

  function desenharPontos() {
    for (var i = 0; i < pontos.length; i++) {
      var p = pontos[i];
      p.x += p.vx; p.y += p.vy; p.f += p.vf;
      if (p.y < -4) { p.y = A + 4; p.x = Math.random() * L; }
      if (p.x < -4) p.x = L + 4;
      if (p.x > L + 4) p.x = -4;
      var a = p.a * (0.5 + 0.5 * Math.sin(p.f));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fillStyle = 'rgba(206,236,255,' + a.toFixed(3) + ')';
      ctx.fill();
    }
  }

  function desenharRiscos() {
    for (var i = riscos.length - 1; i >= 0; i--) {
      var s = riscos[i];
      var dx = Math.cos(s.ang), dy = Math.sin(s.ang);
      s.x += dx * s.v; s.y += dy * s.v;
      var x2 = s.x - dx * s.comp, y2 = s.y - dy * s.comp;

      // halo largo e fraco por baixo, depois o núcleo fino: dá brilho sem
      // shadowBlur, que é caro
      var g1 = ctx.createLinearGradient(s.x, s.y, x2, y2);
      g1.addColorStop(0, 'rgba(120,205,240,' + (s.a * 0.30).toFixed(3) + ')');
      g1.addColorStop(1, 'rgba(120,205,240,0)');
      ctx.strokeStyle = g1; ctx.lineWidth = s.esp * 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x2, y2); ctx.stroke();

      var g2 = ctx.createLinearGradient(s.x, s.y, x2, y2);
      g2.addColorStop(0, 'rgba(232,248,255,' + s.a.toFixed(3) + ')');
      g2.addColorStop(0.3, 'rgba(140,215,245,' + (s.a * 0.5).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(140,215,245,0)');
      ctx.strokeStyle = g2; ctx.lineWidth = s.esp;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x2, y2); ctx.stroke();

      if (s.x - s.comp > L + 60) riscos.splice(i, 1);
    }
  }

  function laco() {
    ctx.clearRect(0, 0, L, A);
    desenharPontos();
    desenharRiscos();
    quadro++;
    // três a quatro riscos convivendo, entrando em intervalos irregulares
    if (quadro % 42 === 0 && riscos.length < 4 && Math.random() < 0.6) novoRisco();
    raf = requestAnimationFrame(laco);
  }

  function comecar() { if (!raf && !reduz) { raf = requestAnimationFrame(laco); } }
  function parar() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  dimensionar();
  if (reduz) {
    // um quadro parado: as estrelas ficam, o movimento não
    ctx.clearRect(0, 0, L, A);
    desenharPontos();
  } else {
    for (var k = 0; k < 2; k++) novoRisco();
    comecar();
  }

  var espera = null;
  window.addEventListener('resize', function () {
    clearTimeout(espera);
    espera = setTimeout(dimensionar, 180);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) parar(); else comecar();
  });
})();
