# MAPA SME — Hotfix Configurações Runner v10

Correção aplicada:

- O adaptador `google.script.run` do GitHub Pages já tinha as funções de Configurações no objeto interno `api`, mas elas não estavam expostas no `createRunner`.
- Isso causava o erro:

`getConfiguracoesMapa is not a function`

Funções adicionadas ao runner:

- `getConfiguracoesMapa()`
- `salvarUsuarioConfiguracao(payload)`
- `removerUsuarioConfiguracao(email)`
- `salvarSeriesExcluidas(seriesMarcadas)`

Este pacote mantém:

- Elefante Letrado integrado.
- Tela Configurações.
- Exclusão da série `PROJETO PROFESSOR ALFABETIZADOR - 13H/A`.

## Como aplicar

Copie o `mapa-sme-main/index.html` por cima do seu `index.html` local e rode:

```cmd
cd /d "C:\Users\DNMCPEREZ\Documents\Projetos\Mapa\mapa-sme-main"
git status
git add index.html
git commit -m "Corrige carregamento da tela de configuracoes"
git push
```

Depois limpe o cache:

```javascript
sessionStorage.clear();
location.reload();
```
