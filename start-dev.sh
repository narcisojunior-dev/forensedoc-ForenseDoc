#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Dependências locais (Postgres + Redis) ───────────────────────────────────
# Exportadas ANTES de subir o backend: o dotenv não sobrescreve variáveis que
# já existem no ambiente, então isto vence o que estiver em backend/.env — que
# aponta para o Railway (postgres.railway.internal) e não é alcançável daqui.
export DATABASE_URL="${DATABASE_URL:-postgresql://forensedoc:forensedoc_dev@localhost:5432/forensedoc_dev}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export NODE_ENV="${NODE_ENV:-development}"

if [ ! -f "$ROOT_DIR/backend/.env" ]; then
  cp "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
  echo ""
  echo "Criei backend/.env a partir do exemplo."
  echo "Nenhuma chave externa é necessária para o fluxo local."
  echo ""
fi

echo "Subindo Postgres e Redis..."
docker compose -f "$ROOT_DIR/docker-compose.dev.yml" up -d

echo "Aguardando os bancos ficarem prontos..."
for _ in $(seq 1 30); do
  ready=$(docker compose -f "$ROOT_DIR/docker-compose.dev.yml" ps 2>/dev/null | grep -c "healthy" || true)
  [ "$ready" -ge 2 ] && break
  sleep 2
done

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

echo "Aplicando migrations..."
(cd "$ROOT_DIR/backend" && node scripts/db-deploy.js)

echo "Populando os planos..."
(cd "$ROOT_DIR/backend" && node prisma/seed.js)

echo "Subindo backend em http://localhost:8787 ..."
(cd "$ROOT_DIR/backend" && npm start) &
BACKEND_PID=$!

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "Para virar admin da plataforma: cadastre-se pela interface e rode"
echo "  cd backend && node scripts/make-admin.js seu@email.com"
echo ""
echo "Os e-mails (verificação, convites) aparecem no log do backend —"
echo "não há SMTP em desenvolvimento."
echo "─────────────────────────────────────────────────────────────"
echo ""

echo "Subindo frontend em http://127.0.0.1:5173 ..."
cd "$ROOT_DIR/frontend"
npm run dev -- --host 127.0.0.1
