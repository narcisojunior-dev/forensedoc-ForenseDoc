#!/usr/bin/env bash
#
# Smoke test pós-deploy (FL.5).
#
# Verifica que o essencial responde depois de cada deploy: saúde, dependências,
# autenticação, isolamento e as proteções de entrada.
#
# Uso:
#   ./scripts/smoke-test.sh                          # localhost:8787
#   BASE_URL=https://api.forensedoc.com.br ./scripts/smoke-test.sh
#
# As contas criadas usam um sufixo aleatório e ficam no banco — rode contra
# staging, ou limpe os tenants de teste depois.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
API="$BASE_URL/api"

PASS=0
FAIL=0

green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
dim()   { printf "\033[0;90m%s\033[0m\n" "$1"; }

# check <descrição> <status esperado> <status recebido> [detalhe]
check() {
  local desc="$1" expected="$2" actual="$3" detail="${4:-}"
  if [ "$actual" = "$expected" ]; then
    green "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    red   "  ✗ $desc (esperado $expected, recebeu $actual)"
    [ -n "$detail" ] && dim "    $detail"
    FAIL=$((FAIL + 1))
  fi
}

status_of() { curl -s -o /dev/null -w "%{http_code}" -m 15 "$@"; }

echo
echo "Smoke test — $BASE_URL"
echo "────────────────────────────────────────────"

# ── 1. Saúde ────────────────────────────────────────────────────────────────
echo "1. Saúde"
check "GET /health responde 200" "200" "$(status_of "$BASE_URL/health")"

READY=$(curl -s -m 15 "$BASE_URL/health/ready")
READY_STATUS=$(echo "$READY" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
check "dependências (db + redis) saudáveis" "ok" "${READY_STATUS:-sem-resposta}" "$READY"

# ── 2. Rotas protegidas ─────────────────────────────────────────────────────
echo "2. Autenticação obrigatória"
for route in credits/balance analyses notifications billing/subscription tenant/members; do
  check "GET /$route sem token → 401" "401" "$(status_of "$API/$route")"
done
check "GET /admin/tenants sem token → 401" "401" "$(status_of "$API/admin/tenants")"
check "token inválido → 401" "401" \
  "$(status_of -H 'Authorization: Bearer token.invalido.aqui' "$API/credits/balance")"

# ── 3. Ciclo de vida da conta ───────────────────────────────────────────────
echo "3. Cadastro e login"
SUFFIX=$(date +%s)$RANDOM
EMAIL="smoke+$SUFFIX@forensedoc.test"
PASSWORD="SmokeTest123"
CPF="$(printf '%011d' $((RANDOM * RANDOM % 100000000000)))"

REGISTER=$(curl -s -m 20 -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"cpfCnpj\":\"$CPF\",\"oabNumber\":\"12345\",\"oabState\":\"PI\"}")
echo "$REGISTER" | grep -q "Cadastro realizado" \
  && check "registro aceito" "ok" "ok" \
  || check "registro aceito" "ok" "falhou" "$REGISTER"

# Login antes da verificação de e-mail deve ser recusado.
LOGIN_STATUS=$(status_of -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
check "login bloqueado antes de verificar e-mail" "403" "$LOGIN_STATUS"

check "senha errada → 401" "401" \
  "$(status_of -X POST "$API/auth/login" -H 'Content-Type: application/json' \
     -d "{\"email\":\"$EMAIL\",\"password\":\"SenhaErrada123\"}")"

check "e-mail duplicado → 400" "400" \
  "$(status_of -X POST "$API/auth/register" -H 'Content-Type: application/json' \
     -d "{\"name\":\"Dup\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"cpfCnpj\":\"98765432100\",\"oabNumber\":\"1\",\"oabState\":\"PI\"}")"

# ── 4. Proteção de entrada ──────────────────────────────────────────────────
echo "4. Validação de upload"
# Sem token o requireAuth barra antes — o que se testa aqui é que a rota não
# aceita chamada anônima; a validação de PDF é coberta por teste unitário.
check "POST /analyze sem token → 401" "401" \
  "$(status_of -X POST "$API/analyze" -H 'Content-Type: application/json' -d '{"pdfBase64":"AAAA"}')"

echo "5. Webhook"
check "webhook sem token → 401 ou 403" "sim" \
  "$(s=$(status_of -X POST "$API/webhooks/asaas" -H 'Content-Type: application/json' -d '{"event":"PAYMENT_RECEIVED"}'); \
     [ "$s" = "401" ] || [ "$s" = "403" ] && echo sim || echo "não ($s)")"

echo "6. Rotas inexistentes"
check "rota desconhecida → 404" "404" "$(status_of "$API/rota-que-nao-existe")"

# ── Resultado ───────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  green "✅ $PASS verificações passaram."
  echo
  dim "Conta de teste criada: $EMAIL (não verificada)"
  exit 0
else
  red "❌ $FAIL de $((PASS + FAIL)) verificações falharam."
  exit 1
fi
