#!/usr/bin/env python3
"""
extrair-claros.py — varre o CSS embutido das páginas do MAPA e lista os
seletores que fixam fundo claro ou texto escuro.

As páginas foram escritas para tema claro, com cor cravada em dezenas de
classes próprias de cada tela. A pele mapa-v2.css não tem como adivinhar
esses nomes, então este script os extrai e emite o bloco de override que
vai colado no fim da pele.

Uso:  python3 tools/extrair-claros.py              (mostra o bloco na tela)
      python3 tools/extrair-claros.py --aplicar   (grava direto na pele)

Com --aplicar, o bloco é escrito dentro dos marcadores que existem em
mapa-v2.css. Só o miolo entre eles é trocado; o resto da folha, escrito à
mão, fica intacto. É essa forma que o workflow de deploy usa.
"""

import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PELE = os.path.join(RAIZ, "mapa-v2.css")

MARCA_INI = "/* >>> INÍCIO DO BLOCO GERADO POR tools/extrair-claros.py — NÃO EDITAR À MÃO >>> */"
MARCA_FIM = "/* <<< FIM DO BLOCO GERADO <<< */"

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


def estilos_embutidos(texto):
    """Atributos style= do documento todo, inclusive dentro de string JS.

    O extrator antigo só lia blocos <style>. As telas montam as linhas de
    dado em JavaScript, com a cor cravada no atributo — era ali que estava
    a maior parte do que ficou ilegível.
    """
    for m in re.finditer(r'style=\\?["\']([^"\']{4,400}?)\\?["\']', texto):
        yield m.group(1)


def declaracoes(bloco):
    for parte in bloco.split(";"):
        if ":" in parte:
            prop, _, val = parte.partition(":")
            yield prop.strip().lower(), val.strip()


def main():
    fundos, textos, bordas = set(), set(), set()

    paginas = [f for f in os.listdir(RAIZ)
               if f.endswith(".html") and "-v2.html" not in f]

    for nome in sorted(paginas):
        with open(os.path.join(RAIZ, nome), encoding="utf-8") as fh:
            texto = fh.read()
        for css in blocos_de_estilo(texto):
            for seletor, decls in regras(css):
                sel = " ".join(seletor.split())
                if not sel or sel[0] in "@%0123456789":
                    continue
                # Nunca mexer no documento inteiro. Precisa ser por parte da
                # vírgula: "html, body" escapava de uma comparação com o
                # seletor inteiro e pintava o body de superfície — foi o que
                # deixou todas as telas ilegíveis, com texto claro sobre claro.
                partes = [x.strip() for x in sel.split(",") if x.strip()]
                partes = [x for x in partes
                          if not re.fullmatch(r"(html|body|:root|\*)", x)]
                if not partes:
                    continue
                sel = ", ".join(partes)
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

    # atributos style= — inclusive os montados em JavaScript
    st_fundo, st_texto = set(), set()
    for nome in sorted(paginas):
        with open(os.path.join(RAIZ, nome), encoding="utf-8") as fh:
            texto = fh.read()
        for bloco in estilos_embutidos(texto):
            for prop, val in declaracoes(bloco):
                hexa = re.search(r"#[0-9a-fA-F]{3,6}", val)
                if prop in ("background", "background-color"):
                    lum = luminancia(hexa.group(0)) if hexa else None
                    if "white" in val.lower() or (lum is not None and lum > 0.58):
                        st_fundo.add(prop + ":" + val.split()[0])
                elif prop == "color" and hexa:
                    lum = luminancia(hexa.group(0))
                    if lum is not None and lum < 0.55:
                        st_texto.add(prop + ":" + hexa.group(0))

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

    if st_fundo:
        saida.append("\n/* fundo claro cravado no atributo style= */")
        saida.append(",\n".join('[style*="%s"]' % x for x in sorted(st_fundo)) + "{")
        saida.append("  background-color:var(--superficie) !important;")
        saida.append("}\n")
    if st_texto:
        saida.append("/* texto escuro cravado no atributo style= */")
        saida.append(",\n".join('[style*="%s"]' % x for x in sorted(st_texto)) + "{")
        saida.append("  color:var(--texto) !important;")
        saida.append("}")

    bloco = "\n".join(saida)
    resumo = f"{len(fundos)} fundos, {len(textos)} textos, {len(bordas)} bordas"

    if "--aplicar" in sys.argv:
        aplicar(bloco, resumo)
    else:
        print(bloco)
        print(f"\n/* {resumo} */", file=sys.stderr)

    print(resumo, file=sys.stderr)


def aplicar(bloco, resumo):
    """Troca o miolo entre os marcadores de mapa-v2.css."""
    with open(PELE, encoding="utf-8") as fh:
        pele = fh.read()

    i = pele.find(MARCA_INI)
    j = pele.find(MARCA_FIM)
    if i == -1 or j == -1 or j < i:
        sys.exit(
            "mapa-v2.css sem os marcadores do bloco gerado.\n"
            "Sem eles não dá para saber o que pode ser trocado e o que foi\n"
            "escrito à mão, e reescrever a folha inteira apagaria o trabalho\n"
            "manual. Recoloque as duas linhas e rode de novo:\n"
            f"  {MARCA_INI}\n  {MARCA_FIM}")

    novo = pele[:i] + MARCA_INI + "\n" + bloco + "\n" + pele[j:]
    if novo == pele:
        print("mapa-v2.css já estava em dia", file=sys.stderr)
        return
    with open(PELE, "w", encoding="utf-8") as fh:
        fh.write(novo)
    print(f"mapa-v2.css atualizado ({resumo})", file=sys.stderr)


if __name__ == "__main__":
    main()
