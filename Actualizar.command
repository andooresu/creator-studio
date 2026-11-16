#!/bin/zsh
# Trae la última versión de Andoo sin tocar tus datos (data/ nunca se sobrescribe).
set -e
cd "$(dirname "$0")"
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" 2>/dev/null || true
source ~/.nvm/nvm.sh 2>/dev/null || true

print -P "%BActualizando Andoo…%b"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  print -P "%F{red}Esta copia no viene de git%f (¿se descargó como ZIP?). Clónala con git para poder actualizar."
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  print -P "%F{red}Hay cambios locales en el código.%f No actualizo para no pisarlos."
  git status --short --untracked-files=no
  exit 1
fi
git pull --ff-only
npm ci --no-audit --no-fund >/dev/null
npx playwright install chromium >/dev/null 2>&1 || true
sh motion/scripts/pyenv.sh >/dev/null 2>&1 || print "Aviso: revisa el motor de video en Ajustes (vuelve a abrir Instalar.command si falta algo)."
npm run build >/dev/null

# Reinicia el servidor si estaba corriendo
# Solo el proceso que ESCUCHA en el puerto (no las conexiones del navegador)
PIDS=(${(f)"$(lsof -ti tcp:4747 -sTCP:LISTEN 2>/dev/null)"})
if (( ${#PIDS} )); then kill $PIDS 2>/dev/null; sleep 1; fi
print -P "%F{green}✓%f Actualizado a $(git log -1 --format='%h · %s')"
"./Abrir Andoo.command"
