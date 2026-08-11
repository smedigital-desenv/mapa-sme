#!/usr/bin/env python3
"""
extrair-claros.py — varre o CSS embutido das páginas do MAPA e lista os
seletores que fixam fundo claro ou texto escuro.

As páginas foram escritas para tema claro, com cor cravada em dezenas de
classes próprias de cada tela. A pele mapa-v2.css não tem como adivinhar
esses nomes, então este script os extrai e emite o bloco de override que
vai colado no fim da pele.

Uso:  python3 tools/extrair-claros.py > /tmp/bloco.css
"""

import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# seletores que a pele já trata à mão — não repetir
JA_TRATADOS = {
    ".card", ".card-box", ".card-kpi", ".mod-card", ".badge", ".alert",
    ".table", ".btn", ".form-control", ".form-select", ".modal-content",
    ".mg-header", ".mg-nav-btn", ".mg-dd-menu", ".mg-dd-item",
}


def luminancia(hexa):
    h = hexa.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def blocos_de_estilo(texto):
    return re.findall(r"<style[^>]*>(.*?)</style>", texto, re.S | re.I)


def regras(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    # Desembrulha @media, @supports e afins. Sem isto, as regras aninhadas
    # escapam do varredor e a cor cravada dentro delas fica sem override —
    # foi o que deixou .sub e .hint ilegíveis no relatório executivo.
    css = re.sub(r"@(?:media|supports|layer|container)[^{]*\{", "", css)
    for m in re.finditer(r"([^{}@]+)\{([^{}]*)\}", css):
        yield m.group(1).strip(), m.group(2)


def main():
    fundos, textos, bordas = set(), set(), set()

    paginas = [f for f in os.listdir(RAIZ)
               if f.endswith(".html") and "-v2.html" not in f]

    for nome in sorted(paginas):
        with open(os.path.join(RAIZ, nome), encoding="utf-8") as fh:
            texto = fh.read()
        for css in blocos_de_estilo(texto):
            for seletor, decls in regras(css):
                if not seletor.startswith(".") or "," in seletor[:1]:
                    continue
                sel = " ".join(seletor.split())
                if any(sel.startswith(t) and (len(sel) == len(t) or sel[len(t)] in ":. ")
                       for t in JA_TRATADOS):
                    continue

                bg = re.search(r"background(?:-color)?\s*:\s*([^;]+)", decls)
                if bg:
                    v = bg.group(1).strip()
                    hexa = re.search(r"#[0-9a-fA-F]{3,6}", v)
                    claro = (
                        "white" in v.lower()
                        or (hexa and (luminancia(hexa.group(0)) or 0) > 0.58)
                        or re.search(r"rgba?\(\s*2[0-9][0-9]\s*,\s*2[0-9][0-9]", v)
                    )
                    if claro:
                        fundos.add(sel)

                cor = re.search(r"(?<!-)\bcolor\s*:\s*(#[0-9a-fA-F]{3,6})", decls)
                if cor:
                    lum = luminancia(cor.group(1))
                    if lum is not None and lum < 0.62:
                        textos.add(sel)

                bd = re.search(r"border(?:-\w+)?\s*:\s*[^;]*#[0-9a-fA-F]{3,6}", decls)
                if bd:
                    hexa = re.search(r"#[0-9a-fA-F]{3,6}", bd.group(0))
                    if hexa and (luminancia(hexa.group(0)) or 0) > 0.80:
                        bordas.add(sel)

    saida = []
    saida.append("/* ─── 11. CORES CRAVADAS NAS PÁGINAS ────────────────────── */")
    saida.append("/* Gerado por tools/extrair-claros.py. As telas foram escritas para tema")
    saida.append("   claro, com a cor fixada em dezenas de classes próprias de cada uma.")
    saida.append("   Este bloco devolve essas classes aos tokens. Regenerar depois de")
    saida.append("   mudar o CSS embutido de alguma página. */\n")

    if fundos:
        saida.append("/* fundos claros -> superfície do tema escuro */")
        saida.append(",\n".join(sorted(fundos)) + "{")
        saida.append("  background:var(--superficie) !important;")
        saida.append("  color:var(--texto);")
        saida.append("}\n")
    if textos:
        saida.append("/* textos escuros -> texto claro */")
        saida.append(",\n".join(sorted(textos)) + "{")
        saida.append("  color:var(--texto) !important;")
        saida.append("}\n")
    if bordas:
        saida.append("/* bordas claras -> borda do tema escuro */")
        saida.append(",\n".join(sorted(bordas)) + "{")
        saida.append("  border-color:var(--borda) !important;")
        saida.append("}")

    print("\n".join(saida))
    print(f"\n/* {len(fundos)} fundos, {len(textos)} textos, {len(bordas)} bordas */",
          file=sys.stderr)
    print(f"{len(fundos)} fundos, {len(textos)} textos, {len(bordas)} bordas",
          file=sys.stderr)


if __name__ == "__main__":
    main()
