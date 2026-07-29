/**
 * Validação de origem em requisições que mudam estado (N9 da auditoria).
 *
 * A proteção contra CSRF hoje é boa, mas de camada única: as rotas de API são
 * autenticadas pelo header `Authorization` (que o navegador não anexa sozinho
 * numa requisição forjada) e o cookie de refresh usa `SameSite=strict`.
 *
 * O problema de depender só do SameSite é que ele é uma decisão do NAVEGADOR:
 * um cliente antigo que o ignore, ou uma mudança futura na heurística do
 * fabricante, derruba a única barreira das rotas que autenticam por cookie —
 * `/auth/refresh` e `/auth/logout`, justamente as que emitem credencial nova.
 *
 * Este guard confere `Origin`/`Referer` contra a mesma allowlist do CORS. É
 * verificação do lado do servidor, então não depende de o navegador cooperar.
 *
 * ─── Por que não um token CSRF sincronizado ──────────────────────────────────
 * O padrão double-submit exigiria um cookie legível por JS e um header em toda
 * chamada, mais um endpoint para emiti-lo. Para uma SPA de origem única, com
 * CORS restrito e token em header, a validação de origem entrega a mesma
 * garantia com muito menos peça móvel.
 */

function parseOrigins() {
  return (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

const ALLOWED = parseOrigins();
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Só métodos que alteram estado. GET/HEAD/OPTIONS ficam de fora: são idempotentes
// e bloqueá-los quebraria navegação e preflight.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originPermitida(origin) {
  if (ALLOWED.includes(origin)) return true;
  if (!IS_PRODUCTION && DEV_ORIGIN_RE.test(origin)) return true;
  return false;
}

export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (origin) {
    if (originPermitida(origin)) return next();
    console.warn(`[CSRF] Requisição bloqueada — Origin não permitida: ${origin}`);
    return res.status(403).json({ error: "Origem não permitida.", code: "CSRF_ORIGIN_REJECTED" });
  }

  // Sem Origin, cai para o Referer. Navegador sempre manda pelo menos um dos
  // dois numa requisição cross-site; um POST forjado por <form> carrega Referer.
  const referer = req.headers.referer;
  if (referer) {
    try {
      if (originPermitida(new URL(referer).origin)) return next();
    } catch {
      /* Referer malformado cai no bloqueio abaixo */
    }
    console.warn(`[CSRF] Requisição bloqueada — Referer não permitido: ${referer}`);
    return res.status(403).json({ error: "Origem não permitida.", code: "CSRF_ORIGIN_REJECTED" });
  }

  // Nenhum dos dois headers: não veio de navegador (curl, Postman, servidor a
  // servidor). Isso NÃO é CSRF — o ataque depende de um navegador anexar cookie
  // automaticamente, e sem navegador não há cookie implícito. Bloquear aqui
  // quebraria integrações legítimas sem fechar nenhum vetor real.
  return next();
}
