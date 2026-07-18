# Rotina local de devolutivas (opção Y)

Roda **na sua máquina** (não no repositório nem no ambiente do Claude). A `service_role`
fica num `.env` local — nunca no repo, nunca no navegador. Sua máquina alcança o Supabase
e o web app do Apps Script normalmente.

## Setup (uma vez)

```bash
cd tools/relatorios
cp .env.example .env
# edite o .env e cole a SUPABASE_SERVICE_KEY (Project Settings ▸ API ▸ service_role)
```

Requisito: **Node 18+** (usa `fetch` e `crypto` nativos — sem `npm install`).

## Uso

### 1. Migrar as devolutivas atuais (Gemini) para o Supabase — uma vez

```bash
node devolutivas-local.mjs migrar-gemini
```

Lê o web app do Apps Script (`lerDevolutivas`) e grava tudo com `modelo = 'gemini'`,
preservando individual/rede/regional/síntese. É idempotente (pode rodar de novo).

### 2. Gerar as devolutivas do Claude (ciclo)

```bash
# a) exporta as visitas que ainda não têm devolutiva do Claude
node devolutivas-local.mjs export          # gera visitas-pendentes.json
#    (use --all para regerar todas, mesmo as já feitas)

# b) envie visitas-pendentes.json ao Claude. Ele devolve devolutivas-claude.json.

# c) grava as devolutivas geradas
node devolutivas-local.mjs import devolutivas-claude.json
```

Regerar com o **mesmo** modelo sobrescreve aquela versão; **modelos diferentes coexistem**
(a tela mostra a mais recente e permite comparar Gemini × Claude).

## Segurança

- `.env`, `visitas-*.json` e `devolutivas-*.json` estão no `.gitignore` — não vão ao repo.
- A `service_role` só existe neste `.env` local. Se vazar, rotacione em Project Settings ▸ API.

## Por que não é automático?

Nesta opção **quem gera a análise é o Claude, numa sessão** — um cron não consegue acioná-lo
sozinho. Para rodar 100% agendado seria preciso uma `ANTHROPIC_API_KEY` (a geração passaria a
ser feita pela API do Claude), via cron na sua máquina ou uma Edge Function no Supabase.
