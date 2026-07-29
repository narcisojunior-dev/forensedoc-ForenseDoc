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
