#!/usr/bin/env bash
# Guarda anti-vazamento da rede SME (hook PreToolUse do Claude Code).
#
# Todo repositório desta rede é PÚBLICO e o histórico do Git é permanente.
# Este hook intercepta `git commit` e bloqueia quando as mudanças staged
# contêm dado pessoal, credencial ou arquivo de dados.
# Falso positivo? Rode o commit com SME_PERMITIR_COMMIT=1.
#
# Só usa bash + git + grep + sed + base64 (tudo vem com o Git for Windows /
# qualquer Linux ou macOS). Nada a instalar nas máquinas.
#
# Também funciona como pre-commit do git (sem stdin JSON):
#   ln -s ../../.claude/hooks/verificar-vazamento.sh .git/hooks/pre-commit

set -u

REPO="$PWD"

# Quando chamado pelo Claude Code, chega um JSON no stdin com o comando.
if [ ! -t 0 ]; then
  ENTRADA="$(cat 2>/dev/null || true)"
  if [ -n "$ENTRADA" ] && printf '%s' "$ENTRADA" | grep -q '"tool_input"'; then
    # Só interessa git commit; qualquer outro comando passa direto.
    printf '%s' "$ENTRADA" | grep -qE 'git([^"|;&]|\\\\)*commit' || exit 0
    CWD_JSON="$(printf '%s' "$ENTRADA" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    [ -n "$CWD_JSON" ] && REPO="$(printf '%s' "$CWD_JSON" | sed 's/\\\\/\//g')"
    M=$(printf '%s' "$ENTRADA" | sed -n 's/.*git[[:space:]]\{1,\}-C[[:space:]]\{1,\}\(\\\"[^\\]*\\\"\|[^ "\\]*\).*/\1/p' | head -1)
    [ -n "${M:-}" ] && REPO="$(printf '%s' "$M" | sed 's/^\\\"//; s/\\\"$//')"
  fi
fi

[ "${SME_PERMITIR_COMMIT:-0}" = "1" ] && exit 0
command -v git >/dev/null 2>&1 || exit 0
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || exit 0

PROBLEMAS=""
falha() { PROBLEMAS="${PROBLEMAS}- $1
"; }

# 1. Arquivo de dados proibido em repositório público
ARQUIVOS_RUINS="$(git -C "$REPO" diff --cached --name-only | grep -iE '\.(sql|csv|dump|xlsx|xls)$' || true)"
if [ -n "$ARQUIVOS_RUINS" ]; then
  while IFS= read -r a; do
    falha "arquivo de dados proibido em repositório público: $a"
  done <<EOF
$ARQUIVOS_RUINS
EOF
fi

# Só as linhas ADICIONADAS do diff staged
ADICIONADAS="$(git -C "$REPO" diff --cached | grep '^+' | grep -v '^+++' | cut -c2- || true)"

if [ -n "$ADICIONADAS" ]; then
  # 2. CPF formatado
  N_CPF=$(printf '%s' "$ADICIONADAS" | grep -cE '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}' || true)
  [ "${N_CPF:-0}" -gt 0 ] && falha "possível CPF em linha adicionada ($N_CPF ocorrência(s))"

  # 3. Chave privada
  printf '%s' "$ADICIONADAS" | grep -q -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
    && falha "chave privada em linha adicionada"

  # 4. Token de acesso do Supabase
  printf '%s' "$ADICIONADAS" | grep -qE '\bsbp_[A-Za-z0-9]{20,}' \
    && falha "token de acesso do Supabase (sbp_...) em linha adicionada"

  # 5. JWT com role service_role (a chave anon é pública e PODE ser versionada;
  #    decodificamos o payload para distinguir uma da outra)
  for PAYLOAD in $(printf '%s' "$ADICIONADAS" \
      | grep -oE 'eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+' \
      | cut -d. -f2 | sort -u); do
    PAD=$(( (4 - ${#PAYLOAD} % 4) % 4 ))
    DECOD="$(printf '%s' "$PAYLOAD" | tr '_-' '/+' | { cat; printf '%.0s=' $(seq 1 $PAD 2>/dev/null); } | base64 -d 2>/dev/null || true)"
    if printf '%s' "$DECOD" | grep -qE '"role"[[:space:]]*:[[:space:]]*"service_role"'; then
      falha "JWT com role service_role em linha adicionada"
      break
    fi
  done

  # 6. E-mail não institucional (institucionais e técnicos são permitidos)
  SUSPEITOS="$(printf '%s' "$ADICIONADAS" \
    | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
    | grep -ivE '@([A-Za-z0-9.-]*\.)?(anthropic\.com|smedigital\.com\.br|supabase\.(co|com)|github\.com|users\.noreply\.github\.com|example\.com|exemplo\.com)$|\.gov\.br$' \
    | sort -u | head -5 || true)"
  [ -n "$SUSPEITOS" ] && falha "e-mail(s) não institucionais: $(printf '%s' "$SUSPEITOS" | tr '\n' ' ')"
fi

if [ -n "$PROBLEMAS" ]; then
  {
    echo "COMMIT BLOQUEADO pela guarda anti-vazamento (repositório público da SME):"
    printf '%s' "$PROBLEMAS"
    echo "Revise as mudanças staged. Falso positivo? Rode com SME_PERMITIR_COMMIT=1."
  } >&2
  exit 2
fi
exit 0
