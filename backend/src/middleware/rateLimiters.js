import { ipKeyGenerator } from "express-rate-limit";
import { createLimiter } from "../utils/rateLimitStore.js";

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
  message: {
    error: "Aguarde 30 segundos entre análises.",
    code: "ANALYSIS_RATE_LIMITED",
  },
  prefix: "rl:analyze:",
});
