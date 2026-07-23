import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "./redis.js";

/**
 * Fábrica dos rate limiters (Seção 2.4).
 *
 * A contagem fica no Redis para que o limite seja global entre instâncias —
 * um contador em memória por processo seria contornável só trocando de
 * instância.
 *
 * Comportamento em falha: **fail-open**. Sem isso, um Redis fora do ar faz o
 * express-rate-limit encaminhar o erro da store para o error handler e
 * transformar toda requisição em 500 — derrubando login, cadastro e
 * recuperação de senha junto com o cache. Como o rate limit é proteção
 * secundária (senhas seguem com bcrypt, rotas com JWT), é preferível degradar
 * o limite a derrubar a autenticação.
 *
 * A contrapartida é real: enquanto o Redis estiver indisponível não há
 * proteção contra força bruta. Por isso a falha é logada como erro — precisa
 * aparecer no monitoramento em vez de passar silenciosa.
 */
export function createLimiter({ prefix, ...options }) {
  const limiter = rateLimit({
    ...options,
    store: new RedisStore({
      prefix,
      sendCommand: (...args) => redis.call(...args),
    }),
  });

  return function rateLimitFailOpen(req, res, next) {
    limiter(req, res, (err) => {
      if (err) {
        console.error(
          `[RateLimit] Redis indisponível (${prefix}) — limite não aplicado nesta requisição:`,
          err.message
        );
        return next(); // segue sem contabilizar, em vez de estourar 500
      }
      next();
    });
  };
}
