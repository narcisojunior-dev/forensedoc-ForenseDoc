#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$ROOT_DIR/backend/.env" ]; then
  cp "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
  echo ""
  echo "Criei backend/.env a partir do exemplo."
  echo "Nenhuma chave externa é necessária. Ajuste apenas PORT se quiser mudar a porta do backend."
  echo ""
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "Instalando dependencias do backend..."
(cd "$ROOT_DIR/backend" && npm install)

echo "Instalando dependencias do frontend..."
(cd "$ROOT_DIR/frontend" && npm install)

echo "Subindo backend em http://localhost:8787 ..."
(cd "$ROOT_DIR/backend" && npm start) &
BACKEND_PID=$!

echo "Subindo frontend em http://127.0.0.1:5173 ..."
cd "$ROOT_DIR/frontend"
npm run dev -- --host 127.0.0.1
