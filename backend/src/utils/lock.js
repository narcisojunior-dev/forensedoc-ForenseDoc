import { redis } from "./redis.js";

/**
 * Mutex distribuído em Redis (M4.4).
 *
 * Um Map em memória não serve: com mais de uma instância do backend cada
 * processo teria seu próprio mapa e o lock não valeria nada. SETNX + TTL
 * funciona entre instâncias e se auto-libera se o processo morrer segurando
 * o lock.
 */

/** Chave do mutex "uma análise por vez" — compartilhada entre API e worker. */
export const analysisLockKey = (tenantId) => `analysis:${tenantId}`;

/**
 * Chave do mutex de compra de avulso. Sem ele, duas compras simultâneas do
 * mesmo tenant contam o limite de desconto antes de qualquer uma gravar seu
 * pagamento e as duas levam o preço promocional.
 */
export const avulsoLockKey = (tenantId) => `avulso:${tenantId}`;

/**
 * Chave do mutex de resgate do convite de fundador. A chave é o CÓDIGO, não o
 * tenant: a corrida que importa é a de dois tenants tentando o mesmo convite ao
 * mesmo tempo — cada um passaria pela validação antes de o outro gravar
 * `usedAt`, e `founderSlotsRemaining` seria decrementado duas vezes.
 */
export const founderLockKey = (code) => `founder:${code}`;

/**
 * Tenta adquirir o lock. Devolve um token de liberação, ou null se já travado.
 * O token evita que uma chamada libere o lock de outra que o readquiriu
 * depois de o TTL expirar.
 */
export async function acquireLock(key, ttlSeconds) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(`lock:${key}`, token, "EX", ttlSeconds, "NX");
  return result === "OK" ? token : null;
}

// Libera apenas se o valor ainda for o nosso token (compare-and-delete atômico).
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export async function releaseLock(key, token) {
  if (!token) return;
  try {
    await redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, token);
  } catch (err) {
    // O TTL garante que o lock some de qualquer forma.
    console.error(`[Lock] Falha ao liberar lock '${key}':`, err.message);
  }
}

/*
 * ─── Semáforo contado: o mutex virou atributo de plano ───────────────────────
 *
 * `acquireLock` concede UM detentor. Era o certo enquanto "uma análise por vez
 * por tenant" fosse regra do produto, mas num cliente B2B com dez funcionários
 * os dez disputam o mesmo slot, e o segundo recebe 409 enquanto a plataforma
 * tem capacidade ociosa.
 *
 * O semáforo abaixo concede até N detentores simultâneos, com N vindo do plano.
 * Com N = 1 o comportamento é idêntico ao mutex anterior, que é o default e
 * preserva o que os assinantes atuais já conhecem.
 *
 * ─── Por que não é um contador com INCR ──────────────────────────────────────
 *
 * A implementação óbvia (INCR, comparar com o limite, DECR ao terminar) tem um
 * defeito grave: se o processo morre antes do DECR, o slot fica ocupado para
 * sempre e o tenant trava até alguém intervir à mão. É o mesmo motivo pelo qual
 * `acquireLock` usa TTL em vez de uma flag.
 *
 * Aqui cada slot é um MEMBRO de um sorted set, pontuado pelo instante de
 * expiração. Antes de contar, os expirados são removidos por score: um worker
 * que morreu segurando um slot o devolve sozinho quando o prazo vence.
 */
const ACQUIRE_SLOT_SCRIPT = `
local chave = KEYS[1]
local agora = tonumber(ARGV[1])
local limite = tonumber(ARGV[2])
local expiraEm = tonumber(ARGV[3])
local token = ARGV[4]

-- Devolve slots de processos que morreram sem liberar.
redis.call("ZREMRANGEBYSCORE", chave, "-inf", agora)

if redis.call("ZCARD", chave) >= limite then
  return 0
end

redis.call("ZADD", chave, expiraEm, token)
-- TTL na chave inteira: se o tenant parar de usar, a chave some sozinha em vez
-- de acumular no Redis para sempre.
redis.call("PEXPIRE", chave, expiraEm - agora + 60000)
return 1`;

/**
 * Ocupa um slot do semáforo, se houver vaga.
 *
 * @param {string} key    identificador do recurso (ex.: `analysis:<tenantId>`)
 * @param {number} limite quantos simultâneos o plano permite
 * @param {number} ttlSeconds prazo máximo de posse do slot
 * @returns {Promise<string|null>} token de liberação, ou null se lotado
 */
export async function acquireSlot(key, limite, ttlSeconds) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const agora = Date.now();
  const ok = await redis.eval(
    ACQUIRE_SLOT_SCRIPT,
    1,
    `slots:${key}`,
    agora,
    Math.max(1, limite),
    agora + ttlSeconds * 1000,
    token
  );
  return ok === 1 ? token : null;
}

/** Devolve o slot. O TTL garante a devolução mesmo se isto nunca rodar. */
export async function releaseSlot(key, token) {
  if (!token) return;
  try {
    await redis.zrem(`slots:${key}`, token);
  } catch (err) {
    console.error(`[Lock] Falha ao liberar slot '${key}':`, err.message);
  }
}

/** Quantos slots estão ocupados agora, desconsiderando os expirados. */
export async function usedSlots(key) {
  const chave = `slots:${key}`;
  await redis.zremrangebyscore(chave, "-inf", Date.now()).catch(() => {});
  return redis.zcard(chave).catch(() => 0);
}
