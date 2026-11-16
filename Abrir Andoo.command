#!/bin/zsh
# Doble clic para abrir Andoo CreatorStudio en el navegador.
cd "$(dirname "$0")"
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" 2>/dev/null || true
source ~/.nvm/nvm.sh 2>/dev/null || true
export PATH="$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "No encuentro Node.js. Ejecuta primero Instalar.command"; exit 1
fi
[ -d node_modules ] || npm ci --no-audit --no-fund
[ -f web/dist/index.html ] || npm run build
mkdir -p data
if ! lsof -ti tcp:4747 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup node server/index.ts > data/server.log 2>&1 &
elif ! ps -o command= -p "$(lsof -ti tcp:4747 -sTCP:LISTEN | head -1)" | grep -q -E "server(/index\.ts|\.js)"; then
  echo "El puerto 4747 está ocupado por otra aplicación. Ciérrala y vuelve a intentar."; exit 1
fi
UP=0
for i in {1..20}; do curl -s -o /dev/null http://localhost:4747 && { UP=1; break; }; sleep 0.5; done
if [ "$UP" != 1 ]; then
  echo "Andoo no arrancó. Últimas líneas del registro:"; tail -20 data/server.log; exit 1
fi
open http://localhost:4747
