import { ipKeyGenerator } from "express-rate-limit";
import { createLimiter } from "../utils/rateLimitStore.js";

/**
 * Teto global por IP, aplicado antes do roteamento (N5 da auditoria).
 *
 * Os limitadores existentes cobriam rotas específicas, mas não havia piso: as
 * rotas públicas sem limitador próprio (`/billing/plans`) e, principalmente, o
 * handler de 404 aceitavam volume ilimitado. Marretar `/api/qualquer-coisa`
 * inexistente consumia event loop e conexões do servidor sem esbarrar em nada.
 *
 * O valor é deliberadamente folgado — 300/min por IP. Ele não substitui os
 * limites por rota (login, análise, admin), que continuam sendo a defesa
 * afiada; serve só para que nenhum caminho fique com teto infinito. Um
 * escritório inteiro atrás de um NAT precisa caber aqui sem atrito.
 *
 * O webhook da Asaas fica de fora: ela entrega notificações em rajada a partir
 * de 4 IPs fixos, e um teto por IP transformaria um pico legítimo de cobrança
 * em pagamento perdido. Aquela rota já tem allowlist de IP e limite próprio.
 */
export const globalLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip)}`,
  skip: (req) => req.path.startsWith("/webhooks/"),
  message: { error: "Limite de requisições excedido. Aguarde um instante." },
  prefix: "rl:global:",
});

/**
 * Limitadores das rotas autenticadas (Seção 2.4 do plano).
 *
 * A chave é o tenant, não o IP: um escritório inteiro atrás de um mesmo IP
 * não pode consumir a cota de outro, e um usuário trocando de rede não
 * escapa do limite. Cai para o IP quando não há autenticação.
 */
function tenantKey(req) {
  return req.tenantId ? `t:${req.tenantId}` : `ip:${ipKeyGenerator(req.ip)}`;
}

/** Limite geral das rotas autenticadas: 200 req/min por tenant. */
export const tenantLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: tenantKey,
  message: { error: "Limite de requisições excedido. Aguarde um instante." },
  prefix: "rl:tenant:",
});

/**
 * Validação de código de fundador: 30 consultas/hora por IP.
 *
 * A rota é pública (o convidado precisa validar o código antes de ter conta),
 * então responde "existe / não existe" para quem perguntar. O código tem 8
 * caracteres de um alfabeto de 31 (~8×10¹¹ combinações), o que já torna a
 * enumeração inviável — o limite é a segunda camada, para que nem valha a
 * pena tentar.
 */
export const founderInviteLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip)}`,
  message: {
    error: "Muitas tentativas de validação de convite. Tente novamente mais tarde.",
    code: "FOUNDER_INVITE_RATE_LIMITED",
  },
  prefix: "rl:founder:",
});

/**
 * Rotas que consultam serviços externos por conta do servidor: 30/min por
 * tenant (N11 da auditoria).
 *
 * `/geocode` e `/ip/:ip` são proxies para Nominatim e ipapi.co. Sob o limite
 * geral de 200/min, um usuário autenticado conseguia disparar tráfego suficiente
 * para queimar a cota gratuita ou fazer o IP do servidor ser banido por esses
 * provedores — punindo todos os outros clientes por conta de um. Nominatim, em
 * particular, exige no máximo 1 req/s por política de uso.
 */
export const externalApiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: tenantKey,
  message: {
    error: "Muitas consultas de localização. Aguarde um instante.",
    code: "GEO_RATE_LIMITED",
  },
  prefix: "rl:geo:",
});

/**
 * Anti-duplo-clique na análise: 1 a cada 30s por tenant.
 *
 * Diferente do lock de concorrência (que serializa análises em andamento),
 * este limite protege contra o usuário reenviando o mesmo PDF ao achar que
 * a página travou — cada reenvio queimaria um crédito.
 */
export const analyzeLimiter = createLimiter({
  windowMs: 30 * 1000,
  max: 1,
  keyGenerator: tenantKey,
  // Só conta requisições que realmente iniciaram uma análise. Sem isto, um
  // PDF inválido (400) ou saldo insuficiente (402) travariam o usuário por
  // 30 segundos por uma tentativa que não chegou a custar nada.
  skipFailedRequests: true,
  message: {
    error: "Aguarde 30 segundos entre análises.",
    code: "ANALYSIS_RATE_LIMITED",
  },
  prefix: "rl:analyze:",
});
