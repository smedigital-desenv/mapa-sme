# MAPA SME — Otimização Fase 1 / MAPA_API v11

Esta versão faz a primeira limpeza técnica sem mudar layout, telas ou regras de cálculo.

## O que mudou

- O MAPA principal passa a chamar `MAPA_API` em vez de `google.script.run`.
- Foi mantida uma compatibilidade temporária com `google.script.run` apenas para evitar quebra de alguma função antiga residual.
- Adicionado cache em memória por sessão para tabelas carregadas sem filtro, reduzindo chamadas repetidas ao Supabase durante a navegação.
- O cache é limpo automaticamente quando salva usuários/configurações de séries.

## O que NÃO mudou

- Visual do sistema.
- Cálculos validados.
- Dados exibidos.
- Integração do Elefante Letrado.
- Tela Configurações.
- Exclusão da série `PROJETO PROFESSOR ALFABETIZADOR - 13H/A`.

## Como aplicar

Copie o `mapa-sme-main/index.html` por cima do seu `index.html` local e rode:

```cmd
cd /d "C:\Users\DNMCPEREZ\Documents\Projetos\Mapa\mapa-sme-main"
git status
git add index.html
git commit -m "Otimiza fase 1 com MAPA API"
git push
```

Depois limpe cache do navegador:

```javascript
sessionStorage.clear();
location.reload();
```

## Próxima fase

A próxima melhoria de velocidade real deve ser criar views/funções SQL no Supabase para devolver os relatórios já resumidos, começando por Turmas.
