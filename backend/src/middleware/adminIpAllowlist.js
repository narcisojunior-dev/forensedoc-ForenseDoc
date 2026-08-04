import { parseCidrList, matchesCidrList } from "../utils/ipAllowlist.js";

/**
 * Restringe o painel da plataforma a origens conhecidas (N2 da auditoria).
 *
 * O papel `isPlatformAdmin` concede crédito manual ilimitado, suspensão de
 * qualquer escritório, edição de preço de todos os planos e leitura do audit
 * log inteiro — e a única barreira era uma flag dentro do JWT. Uma senha de
 * admin comprometida entregava a plataforma financeira toda, com o agravante de
 * o próprio audit log ficar acessível a quem invadiu.
 *
 * Esta é a camada imediata enquanto o segundo fator (TOTP) não existe. Ela não
 * substitui MFA: protege contra credencial roubada usada de fora da rede
 * esperada, não contra a máquina do operador comprometida.
 *
 * ─── Fail-closed, ao contrário do webhook ────────────────────────────────────
 * Em `webhookIpAllowlist` a lista vazia LIBERA, porque bloquear ali derruba o
 * faturamento de clientes que não têm culpa. Aqui a escolha se inverte: a lista
 * vazia BLOQUEIA em produção. O impacto de errar para o lado restritivo é o
 * operador (uma pessoa, que controla a variável) perder o painel até ajustar o
 * env; errar para o lado permissivo é deixar o cofre aberto por esquecimento de
 * configuração. Em desenvolvimento libera, senão ninguém consegue trabalhar.
 */

const ALLOWED = parseCidrList(process.env.ADMIN_ALLOWED_IPS, "ADMIN_ALLOWED_IPS");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (ALLOWED.length === 0 && IS_PRODUCTION) {
  console.error(
    "[Admin] ADMIN_ALLOWED_IPS não configurada — o painel administrativo está " +
      "BLOQUEADO em produção. Defina a variável com o(s) IP(s) do operador."
  );
}

export function adminIpAllowlist(req, res, next) {
  if (ALLOWED.length === 0) {
    if (!IS_PRODUCTION) return next();

    console.error(`[Admin] Acesso bloqueado (allowlist vazia) — IP: ${req.ip}`);
    return res.status(403).json({
      error: "Painel administrativo indisponível: allowlist de IP não configurada.",
      code: "ADMIN_IP_ALLOWLIST_UNSET",
    });
  }

  if (matchesCidrList(req.ip, ALLOWED)) return next();

  // Logado como erro: uma tentativa de acesso admin de fora da allowlist é
  // sinal de credencial vazada, não ruído de configuração.
  console.error(`[Admin] Acesso bloqueado — IP fora da allowlist: ${req.ip}`);
  return res.status(403).json({
    error: "Acesso restrito (origem não autorizada).",
    code: "ADMIN_IP_NOT_ALLOWED",
  });
}
