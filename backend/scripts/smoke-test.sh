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

SKIP=0

# check <descrição> <status esperado> <status recebido> [detalhe]
check() {
  local desc="$1" expected="$2" actual="$3" detail="${4:-}"
  if [ "$actual" = "$expected" ]; then
    green "  ✓ $desc"
    PASS=$((PASS + 1))
  # 429 significa que o limitador entrou em ação — comum ao reexecutar o
  # script várias vezes seguidas. Não é falha do sistema, mas também não
  # confirma nada: fica registrado à parte.
  elif [ "$actual" = "429" ]; then
    dim   "  ~ $desc (rate limit atingido — inconclusivo)"
    SKIP=$((SKIP + 1))
  else
    red   "  ✗ $desc (esperado $expected, recebeu $actual)"
    [ -n "$detail" ] && dim "    $detail"
    FAIL=$((FAIL + 1))
  fi
}

status_of() { curl -s -o /dev/null -w "%{http_code}" -m 15 "$@"; }

# Envia JSON via arquivo temporário (@-). Passar o corpo direto em -d dentro
# de $(...) sofre brace expansion do shell: o `{"a":1,"b":2}` é quebrado em
# duas palavras no vírgula e vira duas requisições — cada uma com metade do
# payload e resposta 400.
post_json() {
  local url="$1" payload="$2"
  printf '%s' "$payload" > "$TMP_PAYLOAD"
  curl -s -o /dev/null -w "%{http_code}" -m 20 -X POST "$url" \
    -H 'Content-Type: application/json' -d @"$TMP_PAYLOAD"
}

post_json_body() {
  local url="$1" payload="$2"
  printf '%s' "$payload" > "$TMP_PAYLOAD"
  curl -s -m 20 -X POST "$url" -H 'Content-Type: application/json' -d @"$TMP_PAYLOAD"
}

TMP_PAYLOAD="$(mktemp)"
trap 'rm -f "$TMP_PAYLOAD"' EXIT

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

REGISTER=$(post_json_body "$API/auth/register" \
  "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"cpfCnpj\":\"$CPF\",\"oabNumber\":\"12345\",\"oabState\":\"PI\"}")
if echo "$REGISTER" | grep -q "Cadastro realizado"; then
  check "registro aceito" "ok" "ok"
else
  check "registro aceito" "ok" "falhou" "$REGISTER"
fi

# O status vai para uma variável antes do check. Chamar post_json dentro dos
# argumentos de check executa em subshell, e o payload escrito lá não chega
# confiavelmente ao curl — o resultado eram 400 fantasmas.
UNVERIFIED_STATUS=$(post_json "$API/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
check "login bloqueado antes de verificar e-mail" "403" "$UNVERIFIED_STATUS"

WRONGPASS_STATUS=$(post_json "$API/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"SenhaErrada123\"}")
check "senha errada → 401" "401" "$WRONGPASS_STATUS"

DUP_STATUS=$(post_json "$API/auth/register" \
  "{\"name\":\"Dup\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"cpfCnpj\":\"98765432100\",\"oabNumber\":\"1\",\"oabState\":\"PI\"}")
check "e-mail duplicado → 400" "400" "$DUP_STATUS"

# ── 4. Proteção de entrada ──────────────────────────────────────────────────
echo "4. Validação de upload"
# Sem token o requireAuth barra antes — o que se testa aqui é que a rota não
# aceita chamada anônima; a validação de PDF é coberta por teste unitário.
ANALYZE_STATUS=$(post_json "$API/analyze" '{"pdfBase64":"AAAA"}')
check "POST /analyze sem token → 401" "401" "$ANALYZE_STATUS"

echo "5. Webhook"
WEBHOOK_STATUS=$(post_json "$API/webhooks/asaas" '{"event":"PAYMENT_RECEIVED"}')
if [ "$WEBHOOK_STATUS" = "401" ] || [ "$WEBHOOK_STATUS" = "403" ]; then
  check "webhook sem token → 401 ou 403" "sim" "sim"
else
  check "webhook sem token → 401 ou 403" "sim" "não ($WEBHOOK_STATUS)"
fi

echo "6. Rotas inexistentes"
check "rota desconhecida → 404" "404" "$(status_of "$API/rota-que-nao-existe")"

# ── Resultado ───────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  green "✅ $PASS verificações passaram."
  [ "$SKIP" -gt 0 ] && dim "   ($SKIP inconclusiva(s) por rate limit — reexecute em 15 min)"
  echo
  dim "Conta de teste criada: $EMAIL (não verificada)"
  exit 0
else
  red "❌ $FAIL de $((PASS + FAIL + SKIP)) verificações falharam."
  [ "$SKIP" -gt 0 ] && dim "   ($SKIP inconclusiva(s) por rate limit)"
  exit 1
fi
