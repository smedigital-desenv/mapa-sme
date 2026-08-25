#!/usr/bin/env bash
# Guarda anti-vazamento da rede SME.
#
# Todo repositório desta rede é PÚBLICO e o histórico do Git é permanente.
# Esta guarda barra dado pessoal, credencial e arquivo de dados ANTES de
# virarem publicação. Falso positivo? Rode com SME_PERMITIR_COMMIT=1.
#
# Ela roda em QUATRO portas aqui, porque fechar só uma não fecha nada:
#
#   1. hook PreToolUse do Claude Code, ferramenta Bash  -> git commit e git push
#   2. hook PreToolUse do Claude Code, ferramentas MCP do GitHub
#      (create_or_update_file, push_files) -> escrita direta pela API, que
#      NÃO passa por git nenhum e por isso escapava de tudo
#   3. hook pre-commit do git  -> vale para quem commita fora do Claude Code
#   4. hook pre-push do git    -> última barreira antes de sair da máquina
#
# A QUINTA porta não é este arquivo: é `.github/workflows/guarda-dados.yml`,
# que roda no GitHub e não depende da máquina de ninguém. Ela pega quem clonou
# sem os hooks. As duas precisam concordar — as duas leem `.guarda-permitidos`.
#
# As portas 3 e 4 se instalam sozinhas: `.githooks/` é versionado e o
# SessionStart aponta `core.hooksPath` para lá. À mão, uma vez por clone:
#   git config core.hooksPath .githooks
#
# Só usa bash + git + grep + sed + base64 — tudo que já vem com o Git for
# Windows, Linux ou macOS. Nada a instalar nas máquinas.

set -u

REPO="$PWD"

# Extensões de arquivo de dados. Um export ou script de carga quase sempre
# carrega dado real junto, sem quem escreveu perceber.
EXT_PROIBIDA='\.(sql|csv|tsv|dump|sqlite|sqlite3|parquet|xls|xlsx|xlsm)$'

PROBLEMAS=""
falha() { PROBLEMAS="${PROBLEMAS}- $1
"; }

# --------------------------------------------------------------------------
# Exceções conferidas uma a uma, em `.guarda-permitidos`. Um caminho por linha,
# com a justificativa depois de `#`. Linha terminada em `/` libera a pasta.
#
# ⚠️ Isto é para arquivo que a extensão barra mas que foi ABERTO e não tem dado
# pessoal nenhum — modelo em branco oferecido para download, definição de
# esquema sem carga. NUNCA para publicar dado com dono.
#
# ⚠️ O MESMO arquivo é lido pelo workflow `guarda-dados.yml` e pela auditoria
# semanal da rede. Se cada um tivesse a sua lista, uma liberaria o que a outra
# barra, e ninguém saberia qual está certa.
# --------------------------------------------------------------------------
PERMITIDOS=""
if [ -f "$REPO/.guarda-permitidos" ]; then
  PERMITIDOS="$(sed 's/#.*//; s/[[:space:]]*$//; s/^[[:space:]]*//' "$REPO/.guarda-permitidos" | grep -v '^$' || true)"
fi

permitido() {
  [ -n "$PERMITIDOS" ] || return 1
  while IFS= read -r LINHA; do
    [ -z "$LINHA" ] && continue
    case "$LINHA" in
      */) case "$1" in "$LINHA"*) return 0 ;; esac ;;
      *)  [ "$1" = "$LINHA" ] && return 0 ;;
    esac
  done <<EOF
$PERMITIDOS
EOF
  return 1
}

# --------------------------------------------------------------------------
# Análise de conteúdo: recebe texto (linhas ADICIONADAS de um diff, ou o
# corpo de uma chamada MCP) e acusa o que não pode ser publicado.
# --------------------------------------------------------------------------
analisar_conteudo() {
  TEXTO="$1"
  ONDE="$2"
  [ -n "$TEXTO" ] || return 0

  # CPF formatado
  N_CPF=$(printf '%s' "$TEXTO" | grep -cE '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}' || true)
  [ "${N_CPF:-0}" -gt 0 ] && falha "possível CPF em $ONDE ($N_CPF ocorrência(s))"

  # Chave privada
  printf '%s' "$TEXTO" | grep -q -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
    && falha "chave privada em $ONDE"

  # Token de acesso do Supabase
  printf '%s' "$TEXTO" | grep -qE '\bsbp_[A-Za-z0-9]{20,}' \
    && falha "token de acesso do Supabase (sbp_...) em $ONDE"

  # JWT com role service_role. A chave anon é pública e PODE ser versionada;
  # decodificamos o payload para distinguir uma da outra.
  for PAYLOAD in $(printf '%s' "$TEXTO" \
      | grep -oE 'eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+' \
      | cut -d. -f2 | sort -u); do
    PAD=$(( (4 - ${#PAYLOAD} % 4) % 4 ))
    DECOD="$(printf '%s' "$PAYLOAD" | tr '_-' '/+' | { cat; printf '%.0s=' $(seq 1 $PAD 2>/dev/null); } | base64 -d 2>/dev/null || true)"
    if printf '%s' "$DECOD" | grep -qE '"role"[[:space:]]*:[[:space:]]*"service_role"'; then
      falha "JWT com role service_role em $ONDE"
      break
    fi
  done

  # ⚠️ O `%` fica FORA da parte local de propósito. Com ele, o coringa do SQL
  # (`email like '%@educacao.pmrp.sp.gov.br'`) casava como se fosse endereço de
  # gente — e uma checagem de domínio virava "dado pessoal publicado". Alarme
  # que acusa o que não é, todo dia, é alarme que as pessoas desligam. Endereço
  # de verdade com `%` na parte local não existe na prática.
  TODOS="$(printf '%s' "$TEXTO" \
    | grep -oE '[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
    | grep -ivE '@([A-Za-z0-9.-]*\.)?(anthropic\.com|smedigital\.com\.br|supabase\.(co|com)|github\.com|users\.noreply\.github\.com|example\.com|exemplo\.com)$' \
    | sort -u || true)"

  # E-mail de pessoa, fora dos domínios técnicos
  SUSPEITOS="$(printf '%s' "$TODOS" | grep -ivE '\.gov\.br$' | head -5 || true)"
  [ -n "$SUSPEITOS" ] && falha "e-mail(s) não institucionais em $ONDE: $(printf '%s' "$SUSPEITOS" | tr '\n' ' ')"

  # LISTA de e-mails institucionais. Um endereço de contato num documento é
  # legítimo; três ou mais é cadastro de gente, e foi exatamente essa a forma
  # do vazamento de 2026-08 (3.152 endereços @educacao.pmrp.sp.gov.br dentro
  # de scripts de carga). O domínio institucional não torna o dado impessoal.
  N_INST=$(printf '%s' "$TODOS" | grep -icE '\.gov\.br$' || true)
  [ "${N_INST:-0}" -ge 3 ] \
    && falha "lista de e-mails institucionais em $ONDE ($N_INST endereços distintos) — isso é dado pessoal"

  return 0
}

# --------------------------------------------------------------------------
# Porta 1a: o que está staged (git commit)
# --------------------------------------------------------------------------
checar_staged() {
  # --diff-filter=d exclui as EXCLUSÕES: apagar um arquivo proibido é a
  # correção, não a falta. Sem isso a guarda impedia limpar um vazamento já
  # feito — ela tornava permanente todo vazamento que já tivesse acontecido.
  RUINS="$(git -C "$REPO" diff --cached --name-only --diff-filter=d | grep -iE "$EXT_PROIBIDA" || true)"
  if [ -n "$RUINS" ]; then
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      permitido "$a" && continue
      falha "arquivo de dados proibido em repositório público: $a"
    done <<EOF
$RUINS
EOF
  fi
  analisar_conteudo "$(git -C "$REPO" diff --cached --diff-filter=d | grep '^+' | grep -v '^+++' | cut -c2- || true)" "linha adicionada"
}

# --------------------------------------------------------------------------
# Porta 1b: o que ainda não está em remoto nenhum (git push)
#
# Commit passa; push publica. Quem commitou antes de a guarda existir, ou com
# a válvula ligada, ainda seria publicado sem ninguém olhar.
#
# O recorte são os commits locais que nenhum remoto tem — não a árvore
# inteira. Bloquear todo push de um repositório que já tem .sql versionado
# de antes faria as pessoas deixarem SME_PERMITIR_COMMIT=1 ligado para
# sempre, e aí a guarda não guarda mais nada.
# --------------------------------------------------------------------------
checar_push() {
  # Pergunta 1: o que está VERSIONADO agora? Pega o que entrou por qualquer
  # outro caminho — `--no-verify`, `git add -f`, outra máquina, outra
  # ferramenta, ou antes de a guarda existir.
  ARVORE="$(git -C "$REPO" ls-files | grep -iE "$EXT_PROIBIDA" || true)"
  if [ -n "$ARVORE" ]; then
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      permitido "$a" && continue
      falha "arquivo de dados VERSIONADO: $a (tire com \`git rm --cached\`, ou justifique em .guarda-permitidos se for modelo sem dado)"
    done <<EOF
$ARVORE
EOF
  fi

  git -C "$REPO" for-each-ref --format='%(refname)' refs/remotes 2>/dev/null | grep -q . || return 0

  # Pergunta 2: e o que os commits ainda não publicados TOCARAM? Arquivo que
  # entrou e saiu antes do push não aparece na árvore, mas publicar a série
  # publica o commit do meio, com ele dentro.
  RUINS="$(git -C "$REPO" log --name-only --diff-filter=d --pretty=format: HEAD --not --remotes 2>/dev/null \
           | grep -iE "$EXT_PROIBIDA" | sort -u || true)"
  if [ -n "$RUINS" ]; then
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      permitido "$a" && continue
      falha "commit ainda não publicado traz arquivo de dados: $a"
    done <<EOF
$RUINS
EOF
  fi
  analisar_conteudo "$(git -C "$REPO" log -p --diff-filter=d --pretty=format: HEAD --not --remotes 2>/dev/null \
                       | grep '^+' | grep -v '^+++' | cut -c2- || true)" "commit ainda não publicado"
}

# --------------------------------------------------------------------------
# Porta 2: escrita direta pela API do GitHub (ferramentas MCP)
#
# Estas ferramentas gravam no repositório remoto sem passar por git nenhum:
# nenhum hook de git as vê, e a checagem de commit tampouco. Era o caminho
# por onde um arquivo proibido subia sem encontrar barreira alguma.
# --------------------------------------------------------------------------
checar_mcp() {
  CORPO="$1"
  CAMINHOS="$(printf '%s' "$CORPO" \
    | grep -oE '"(path|file_path|filename)"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | sed 's/.*:[[:space:]]*"//; s/"$//' | sort -u || true)"
  if [ -n "$CAMINHOS" ]; then
    while IFS= read -r a; do
      printf '%s' "$a" | grep -qiE "$EXT_PROIBIDA" || continue
      permitido "$a" && continue
      falha "arquivo de dados indo direto para o GitHub pela API: $a"
    done <<EOF
$CAMINHOS
EOF
  fi
  analisar_conteudo "$CORPO" "conteúdo enviado ao GitHub pela API"
}

# --------------------------------------------------------------------------
# Descobrir por qual porta entramos
# --------------------------------------------------------------------------
FERRAMENTA=""
ENTRADA=""
if [ ! -t 0 ]; then
  ENTRADA="$(cat 2>/dev/null || true)"
fi

if [ -n "$ENTRADA" ] && printf '%s' "$ENTRADA" | grep -q '"tool_input"'; then
  FERRAMENTA="$(printf '%s' "$ENTRADA" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  CWD_JSON="$(printf '%s' "$ENTRADA" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$CWD_JSON" ] && REPO="$(printf '%s' "$CWD_JSON" | sed 's/\\\\/\//g')"
fi

[ "${SME_PERMITIR_COMMIT:-0}" = "1" ] && exit 0
command -v git >/dev/null 2>&1 || exit 0

case "$FERRAMENTA" in
  *create_or_update_file|*push_files)
    # Não exige repositório local: a escrita é remota.
    checar_mcp "$ENTRADA"
    ;;
  Bash|"")
    if [ -n "$ENTRADA" ] && [ -n "$FERRAMENTA" ]; then
      # Veio do Claude Code: só interessam commit e push.
      COMMIT=0; PUSH=0
      printf '%s' "$ENTRADA" | grep -qE 'git([^"|;&]|\\\\)*commit' && COMMIT=1
      printf '%s' "$ENTRADA" | grep -qE 'git([^"|;&]|\\\\)*push'   && PUSH=1
      [ "$COMMIT" = 0 ] && [ "$PUSH" = 0 ] && exit 0
      M=$(printf '%s' "$ENTRADA" | sed -n 's/.*git[[:space:]]\{1,\}-C[[:space:]]\{1,\}\(\\\"[^\\]*\\\"\|[^ "\\]*\).*/\1/p' | head -1)
      [ -n "${M:-}" ] && REPO="$(printf '%s' "$M" | sed 's/^\\\"//; s/\\\"$//')"
      git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || exit 0
      [ "$COMMIT" = 1 ] && checar_staged
      [ "$PUSH" = 1 ] && checar_push
    else
      # Veio do git (pre-commit / pre-push) ou foi chamada à mão.
      git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || exit 0
      case "${SME_GUARDA_MODO:-commit}" in
        push) checar_push ;;
        *)    checar_staged ;;
      esac
    fi
    ;;
  *)
    exit 0
    ;;
esac

if [ -n "$PROBLEMAS" ]; then
  {
    echo "BLOQUEADO pela guarda anti-vazamento (repositório público da SME):"
    printf '%s' "$PROBLEMAS"
    echo "Script de banco e export não se versionam — entregue fora do repositório."
    echo "Falso positivo? Rode com SME_PERMITIR_COMMIT=1."
  } >&2
  exit 2
fi
exit 0
