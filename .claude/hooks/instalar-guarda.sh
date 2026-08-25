#!/usr/bin/env bash
# Aponta os hooks do git para .githooks/, que é versionado.
#
# .git/hooks/ não é versionado e não sobrevive a um clone novo — e todo
# ambiente do Claude Code na web clona do zero. Sem esta linha, a guarda só
# valeria dentro do Claude Code, e um `git commit` no terminal publicaria
# qualquer coisa.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
[ "$(git config core.hooksPath || true)" = ".githooks" ] || git config core.hooksPath .githooks
exit 0
