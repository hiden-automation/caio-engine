#!/usr/bin/env bash
# Commita o que o CLI mudou no caio-data (main) e na branch previews.
# Uso: scripts/ci/save.sh "mensagem"
set -euo pipefail
msg="jarvis: ${1:-atualização}"

push_with_retry() {
  local dir=$1 branch=$2
  git -C "$dir" add -A
  if git -C "$dir" diff --cached --quiet; then
    echo "[save] $dir: nada a commitar"
    return
  fi
  git -C "$dir" commit -q -m "$msg"
  for i in 1 2 3 4 5; do
    if git -C "$dir" push -q origin "HEAD:$branch"; then
      echo "[save] $dir: enviado"
      return
    fi
    # Outro workflow (ou o PWA) escreveu antes: rebase e tenta de novo.
    git -C "$dir" pull -q --rebase origin "$branch" || true
    sleep $((i * 3))
  done
  echo "[save] $dir: falhou após 5 tentativas" >&2
  exit 1
}

# Previews e base primeiro: o feed do main só aponta para arquivos que já existem.
push_with_retry previews previews
if [ -d library/.git ]; then push_with_retry library library; fi
push_with_retry data main
