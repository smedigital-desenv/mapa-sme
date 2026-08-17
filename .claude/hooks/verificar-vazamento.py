#!/usr/bin/env python3
"""Guarda anti-vazamento da rede SME (hook PreToolUse do Claude Code).

Todo repositório desta rede é PÚBLICO e o histórico do Git é permanente.
Este hook intercepta `git commit` e bloqueia quando as mudanças staged
contêm dado pessoal, credencial ou arquivo de dados. Falso positivo?
Rode o commit com SME_PERMITIR_COMMIT=1.

Também funciona como pre-commit do git: sem stdin JSON, verifica o
repositório atual (instale com:
  ln -s ../../.claude/hooks/verificar-vazamento.py .git/hooks/pre-commit).
"""
import base64
import json
import os
import re
import subprocess
import sys

# E-mails institucionais/públicos não bloqueiam; o risco é o e-mail pessoal.
DOMINIOS_PERMITIDOS = (
    "anthropic.com",
    "smedigital.com.br",
    "supabase.co",
    "supabase.com",
    "github.com",
    "users.noreply.github.com",
    "example.com",
    "exemplo.com",
    ".gov.br",
)

EXT_PROIBIDAS = re.compile(r"\.(sql|csv|dump|xlsx|xls)$", re.I)
RE_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
RE_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RE_JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]+")
RE_CHAVE_PRIVADA = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
RE_TOKEN_SUPABASE = re.compile(r"\bsbp_[A-Za-z0-9]{20,}")


def jwt_e_service_role(payload_b64: str) -> bool:
    """A chave anon é pública e pode ser versionada; a service_role jamais."""
    try:
        payload = base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4))
        return json.loads(payload).get("role") == "service_role"
    except Exception:
        return False


def git(repo: str, *args: str) -> str:
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return r.stdout


def main() -> int:
    repo = os.getcwd()
    if not sys.stdin.isatty():
        try:
            entrada = json.load(sys.stdin)
        except Exception:
            entrada = {}
        if entrada:
            comando = (entrada.get("tool_input") or {}).get("command", "")
            if not re.search(r"\bgit\b[^|;&]*\bcommit\b", comando):
                return 0
            m = re.search(r'git\s+-C\s+("[^"]+"|\S+)', comando)
            repo = m.group(1).strip('"') if m else entrada.get("cwd") or repo

    if os.environ.get("SME_PERMITIR_COMMIT") == "1":
        return 0

    problemas = []

    for arq in git(repo, "diff", "--cached", "--name-only").splitlines():
        if EXT_PROIBIDAS.search(arq):
            problemas.append(f"arquivo de dados proibido em repositório público: {arq}")

    diff = git(repo, "diff", "--cached")
    adicionadas = "\n".join(
        linha[1:]
        for linha in diff.splitlines()
        if linha.startswith("+") and not linha.startswith("+++")
    )

    n_cpf = len(RE_CPF.findall(adicionadas))
    if n_cpf:
        problemas.append(f"possível CPF em linha adicionada ({n_cpf} ocorrência(s))")

    if RE_CHAVE_PRIVADA.search(adicionadas):
        problemas.append("chave privada em linha adicionada")

    if RE_TOKEN_SUPABASE.search(adicionadas):
        problemas.append("token de acesso do Supabase (sbp_...) em linha adicionada")

    for m in RE_JWT.finditer(adicionadas):
        if jwt_e_service_role(m.group(1)):
            problemas.append("JWT com role service_role em linha adicionada")
            break

    suspeitos = sorted(
        {
            e
            for e in RE_EMAIL.findall(adicionadas)
            if not e.lower().endswith(DOMINIOS_PERMITIDOS)
        }
    )
    if suspeitos:
        problemas.append("e-mail(s) não institucionais: " + ", ".join(suspeitos[:5]))

    if problemas:
        print(
            "COMMIT BLOQUEADO pela guarda anti-vazamento (repositório público da SME):\n- "
            + "\n- ".join(problemas)
            + "\nRevise as mudanças staged. Falso positivo? Rode com SME_PERMITIR_COMMIT=1.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
