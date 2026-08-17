---
name: publicar
description: Executa o ritual de publicação da rede SME - push confirmado por hash, disparo manual do workflow de deploy do GitHub Pages, alinhamento de Edge Functions e teste de cache. Use quando pedirem para publicar, fazer deploy, subir para produção ou homologação.
---

# Publicar — ritual da rede SME

O deploy nesta rede tem armadilhas documentadas no CLAUDE.md que já causaram
horas de diagnóstico perdido. Siga o ritual completo, na ordem.

## 0. Antes de qualquer push

- Confira a branch: `main` publica produção; se o repositório tiver
  homologação (`develop` → `/teste`), confirme qual é o destino pedido.
- Rode a validação que o repositório tiver (build do Vite, gerador `-v2`,
  etc. — o CLAUDE.md local diz qual é). Não publique com build quebrado.
- Confira `git status` — mudança fora do escopo pedido não embarca junto.

## 1. Push confirmado por HASH, nunca pela mensagem

`git push | tail` esconde "Everything up-to-date". Sempre:

```bash
git push origin <branch>
git fetch origin -q && git rev-parse --short origin/<branch>
```

Compare com `git rev-parse --short HEAD`. **Iguais = publicado; diferentes =
o push não subiu, investigue antes de continuar.**

## 2. Disparar o deploy manualmente

**Push feito por token de automação NÃO dispara o workflow do GitHub Pages.**
Depois do push:

- Com ferramenta do GitHub disponível (MCP/`gh`): dispare o workflow de deploy
  do repositório (em geral `deploy-pages.yml`) na branch publicada e
  acompanhe até concluir.
- Sem ferramenta: instrua a pessoa a rodar pela aba **Actions** do GitHub.

Exceção: repositório que publica com `gh-pages` via npm (ex.: `questoes`,
`npm run deploy`) não usa Actions — e esse comando **só roda com autorização
explícita**, porque publica produção direto.

## 3. Edge Functions não vão junto no deploy

Se o diff publicado tocar `supabase/functions/**`, o site novo vai conversar
com função velha — o sintoma clássico é erro com status 200 ("não foi
possível abrir sua sessão"). Avise que é preciso republicar a função pelo
painel do Supabase ou pela CLI, com o modo certo de **Verify JWT** (o
CLAUDE.md do repositório diz qual — ex.: no MAPA, `central-bridge` publica
com Verify JWT DESLIGADO e `coderp-ficha` com LIGADO).

## 4. Conferência final

- Aguarde o workflow concluir e abra a URL publicada.
- Navegador segura cache: teste em **aba anônima** ou com Ctrl+Shift+R antes
  de concluir que "não mudou nada".
- Se a tela depender de banco: um `403`/`permission denied` novo costuma ser
  proteção funcionando — antes de "consertar" com grant, releia a seção de
  segurança do CLAUDE.md (ou rode a skill `auditoria-rls`).

## Relatório

Ao final, informe: hash publicado (local × remoto), execução do workflow
(link/status), funções pendentes de republicação (se houver) e o que foi
conferido na URL pública.
