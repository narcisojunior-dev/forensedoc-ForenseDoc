import { redis } from "./redis.js";
import { normalizeEmail } from "./stringUtils.js";

/**
 * Atraso progressivo nas falhas de login (N6 da auditoria).
 *
 * O bloqueio por conta corta em 5 falhas / 30 min; este atraso encarece as
 * tentativas ANTES disso. Um atacante que consiga 5 tentativas por janela em
 * milhares de contas simultâneas ainda extrai muita vazão de um limite fixo —
 * o custo por tentativa precisa subir.
 *
 * ─── Por que isto não reintroduz enumeração de contas ────────────────────────
 * O contador é chaveado pelo e-mail NORMALIZADO, exista ou não a conta. Um
 * endereço sem cadastro acumula atraso igual ao de um cadastrado, então o tempo
 * de resposta continua não distinguindo os dois — que é a propriedade
 * conquistada em M3 e que este mecanismo não pode desfazer.
 *
 * ─── Por que o teto é baixo ──────────────────────────────────────────────────
 * Cada requisição atrasada segura uma conexão do servidor. Um atraso "de
 * verdade" (30s, 60s) viraria arma de negação de serviço contra a própria
 * aplicação: o atacante abriria conexões de graça e nós as manteríamos abertas
 * por ele. 4s é suficiente para inviabilizar força bruta em escala sem dar essa
 * alavanca — e o bloqueio por conta entra logo em seguida.
 */

const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 4000;
const WINDOW_SECONDS = 30 * 60; // acompanha a janela do bloqueio por conta

const key = (email) => `login:fail:${normalizeEmail(email)}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Aplica o atraso correspondente às falhas já acumuladas por esta conta.
 * Chamar ANTES de responder o 401.
 *
 * Falha do Redis é ignorada de propósito (fail-open): o atraso é defesa
 * secundária e não pode transformar cache indisponível em login quebrado —
 * mesma decisão já tomada em rateLimitStore e no requireAuth.
 */
export async function applyLoginBackoff(email) {
  try {
    const fails = Number(await redis.get(key(email))) || 0;
    if (fails <= 0) return 0;

    const delay = Math.min(BASE_DELAY_MS * 2 ** (fails - 1), MAX_DELAY_MS);
    await sleep(delay);
    return delay;
  } catch (err) {
    console.error("[LoginBackoff] Redis indisponível, atraso não aplicado:", err.message);
    return 0;
  }
}

/** Registra mais uma falha para esta conta e renova a janela. */
export async function registerLoginFailure(email) {
  try {
    const k = key(email);
    await redis.incr(k);
    await redis.expire(k, WINDOW_SECONDS);
  } catch (err) {
    console.error("[LoginBackoff] Falha ao contabilizar tentativa:", err.message);
  }
}

/** Zera o contador — o login deu certo, o dono legítimo não deve pagar atraso. */
export async function clearLoginFailures(email) {
  try {
    await redis.del(key(email));
  } catch (err) {
    console.error("[LoginBackoff] Falha ao limpar contador:", err.message);
  }
}
