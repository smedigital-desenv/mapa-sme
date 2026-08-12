#!/usr/bin/env python3
"""
gerar-v2.py — cria as páginas de teste *-v2.html do MAPA.

Não altera nenhum arquivo existente. Para cada página da raiz, escreve
uma cópia <nome>-v2.html idêntica, com quatro acréscimos:

  1. atributos de tema no <html> (Bootstrap escuro + tokens da SME);
  2. <link> para mapa-v2.css no fim do <head>, para entrar depois do
     CSS embutido da página e sobrescrevê-lo;
  3. faixa de aviso, canvas do fundo e arcos, logo após o <body>;
  4. defaults do Chart.js, logo depois do script do Chart.

Os links internos passam a apontar para as versões -v2, para a
navegação não cair na página em uso no meio do teste.

Uso:   python3 tools/gerar-v2.py
       python3 tools/gerar-v2.py --limpar     (apaga as -v2)
"""

import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUFIXO = "-v2"

# páginas que não valem uma versão de teste
IGNORAR = {"login.html"}

CABECA = """
<!-- ↓↓↓ acrescentado por tools/gerar-v2.py — pele de teste ↓↓↓ -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="mapa-v2.css">
<!-- ↑↑↑ -->
"""

CORPO = """
<div class="v2-faixa">
  <b>VERSÃO 2 · TESTE</b>
  <span>Esta página é uma cópia para avaliar o visual novo. A que está em uso continua em</span>
  <a href="{original}">{original}</a>
</div>
<canvas id="ceu" aria-hidden="true"></canvas>
<span class="v2-orbita v2-orbita--1" aria-hidden="true"></span>
<span class="v2-orbita v2-orbita--2" aria-hidden="true"></span>
<span class="v2-orbita v2-orbita--3" aria-hidden="true"></span>
"""

# Cores dos gráficos vêm do JS, não do CSS. Definir os defaults logo depois
# do Chart.js pega todos os gráficos criados adiante, sem tocar no código
# de cada página.
CHART = """
<script>
/* defaults do Chart.js para o visual de teste — acrescentado por gerar-v2.py */
(function () {
  if (!window.Chart) return;
  var C = window.Chart;
  C.defaults.color = '#94A0AB';
  C.defaults.borderColor = 'rgba(255,255,255,.10)';
  C.defaults.font.family = 'DM Sans, system-ui, sans-serif';
  if (C.defaults.plugins && C.defaults.plugins.legend) {
    C.defaults.plugins.legend.labels.color = '#94A0AB';
  }
  if (C.defaults.scales) {
    ['linear', 'category', 'radialLinear'].forEach(function (k) {
      if (!C.defaults.scales[k]) return;
      if (C.defaults.scales[k].grid) C.defaults.scales[k].grid.color = 'rgba(255,255,255,.08)';
      if (C.defaults.scales[k].ticks) C.defaults.scales[k].ticks.color = '#8996A3';
    });
  }
})();
</script>
"""

CEU = '<script src="mapa-v2-ceu.js" defer></script>\n'


def paginas():
    return sorted(
        f for f in os.listdir(RAIZ)
        if f.endswith(".html") and SUFIXO + ".html" not in f and f not in IGNORAR
    )


def limpar():
    n = 0
    for f in os.listdir(RAIZ):
        if f.endswith(SUFIXO + ".html"):
            os.remove(os.path.join(RAIZ, f))
            n += 1
    print(f"{n} páginas -v2 removidas")


def converter(nome, todas):
    caminho = os.path.join(RAIZ, nome)
    with open(caminho, encoding="utf-8") as fh:
        s = fh.read()

    # 1. atributos de tema no <html>
    def marca_html(m):
        attrs = m.group(1)
        for a in ('data-bs-theme="dark"', 'data-tema="escuro"',
                  'data-acento="ciano"', 'data-fundo="medio"'):
            if a.split("=")[0] not in attrs:
                attrs += " " + a
        return "<html" + attrs + ">"

    s, n = re.subn(r"<html([^>]*)>", marca_html, s, count=1)
    if not n:
        return None, "sem tag <html>"

    # 2. CSS por último, para vencer o <style> embutido da página
    if "</head>" not in s:
        return None, "sem </head>"
    s = s.replace("</head>", CABECA + "</head>", 1)

    # 3. faixa, canvas e arcos logo depois do <body>
    s, n = re.subn(r"(<body[^>]*>)", lambda m: m.group(1) + CORPO.format(original=nome),
                   s, count=1)
    if not n:
        return None, "sem tag <body>"

    # 4. defaults do Chart.js depois do script do Chart, quando houver
    s = re.sub(
        r'(<script[^>]*src="[^"]*chart[^"]*"[^>]*>\s*</script>)',
        lambda m: m.group(1) + CHART,
        s, count=1, flags=re.I)

    # Canvas do fundo, antes do ÚLTIMO </body>.
    # Não pode ser o primeiro: elefante, fluencia e relatorio_executivo montam
    # exportação para Word/Excel com a string '</body></html>' dentro do
    # JavaScript. Inserir no primeiro punha a tag dentro do literal e quebrava
    # o script inteiro da página.
    i = s.rfind("</body>")
    if i != -1:
        s = s[:i] + CEU + s[i:]

    # 5. navegação interna fica dentro da versão de teste
    for outra in todas:
        base = outra[:-5]
        s = re.sub(r'(href=")' + re.escape(outra) + r'(["#?])',
                   r'\1' + base + SUFIXO + r'.html\2', s)

    destino = os.path.join(RAIZ, nome[:-5] + SUFIXO + ".html")
    with open(destino, "w", encoding="utf-8") as fh:
        fh.write(s)
    return os.path.basename(destino), None


def main():
    if "--limpar" in sys.argv:
        limpar()
        return
    todas = paginas()
    print(f"{len(todas)} páginas encontradas\n")
    ok = falhas = 0
    for nome in todas:
        destino, erro = converter(nome, todas)
        if erro:
            print(f"  ✗ {nome:<28} {erro}")
            falhas += 1
        else:
            print(f"  ✓ {nome:<28} -> {destino}")
            ok += 1
    print(f"\n{ok} geradas, {falhas} com problema")


if __name__ == "__main__":
    main()
