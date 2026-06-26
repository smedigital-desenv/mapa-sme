# MAPA SME — Atualização Elefante Letrado + Configurações v9

Este pacote reúne novamente as duas correções solicitadas:

1. Integração do módulo Elefante Letrado dentro do MAPA.
2. Tela Configurações para usuários/acessos e séries excluídas dos relatórios.
3. Correção da série `PROJETO PROFESSOR ALFABETIZADOR - 13H/A`, que estava causando o Magistério II aparecer com +1 turma.

## Arquivos principais

- `mapa-sme-main/index.html`
- `mapa-sme-main/elefante_letrado.html`
- `mapa-sme-main/css/elefante.css`
- `sql/00_configuracoes_usuarios_series.sql`
- `sql/01_corrigir_exclusao_13ha.sql`

## Antes de testar

Rode no Supabase SQL Editor:

1. `sql/00_configuracoes_usuarios_series.sql`
2. `sql/01_corrigir_exclusao_13ha.sql`

Os scripts são seguros para rodar mais de uma vez.

## Como aplicar no projeto local

Copie o conteúdo da pasta `mapa-sme-main` deste pacote por cima da sua pasta local:

`C:\Users\DNMCPEREZ\Documents\Projetos\Mapa\mapa-sme-main`

Depois rode:

```cmd
cd /d "C:\Users\DNMCPEREZ\Documents\Projetos\Mapa\mapa-sme-main"
git status
git add .
git commit -m "Atualiza Elefante Letrado e configuracoes"
git push
```

Depois limpe o cache do navegador:

```javascript
sessionStorage.clear();
location.reload();
```

## Observação

O Elefante Letrado foi integrado por iframe interno para preservar a lógica original do módulo e reduzir risco de quebrar o MAPA principal.
