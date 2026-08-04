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
/*
 * ─── Cota justa entre colegas de equipe ──────────────────────────────────────
 *
 * O semáforo é do TENANT, então um usuário que envia 50 documentos ocupava todas
 * as vagas e deixava os colegas sem nenhuma. Para eles a tela apenas repetia "já
 * existe análise em andamento", sem indicar que a causa era outra pessoa.
 *
 * A cota de cada usuário é o limite do plano dividido por quantos DISPUTAM a
 * capacidade agora. Com um usuário ativo, a cota é o limite inteiro: nenhuma
 * capacidade fica ociosa. Quando o segundo chega, o primeiro para de crescer,
 * mas não é preemptado; à medida que ele libera, o segundo ocupa.
 *
 * ─── Por que os RECUSADOS também contam ──────────────────────────────────────
 *
 * A primeira versão contava só quem detinha vaga, e tinha um furo que só
 * apareceu no teste contra Redis: quem chegava primeiro e enchia tudo continuava
 * sozinho no conjunto, então liberava uma vaga e a retomava imediatamente com a
 * cota cheia. O colega nunca entrava.
 *
 * Por isso a recusa registra o usuário num conjunto de PRETENDENTES, com prazo
 * curto. Ele passa a contar na divisão, o que derruba a cota de quem está
 * segurando as vagas e abre espaço na próxima liberação. O prazo curto é o que
 * faz o pretendente sumir sozinho quando desiste, devolvendo a capacidade a quem
 * ficou.
 */
const ACQUIRE_SLOT_SCRIPT = `
local chave = KEYS[1]
local chavePretendentes = KEYS[2]
local agora = tonumber(ARGV[1])
local limite = tonumber(ARGV[2])
local expiraEm = tonumber(ARGV[3])
local token = ARGV[4]
local usuario = ARGV[5]
local prazoPretendente = tonumber(ARGV[6])

-- Devolve vagas de processos que morreram sem liberar, e esquece pretendentes
-- que desistiram.
redis.call("ZREMRANGEBYSCORE", chave, "-inf", agora)
redis.call("ZREMRANGEBYSCORE", chavePretendentes, "-inf", agora)

local ocupados = redis.call("ZRANGE", chave, 0, -1)

-- Quantos slots ESTE usuário já detém, e quem são os donos distintos. O membro
-- tem a forma "<usuario>:<token>", então o prefixo até o primeiro ":" é o dono.
local meus = 0
local disputantes = {}
local qtdDisputantes = 0
for _, membro in ipairs(ocupados) do
  local dono = string.match(membro, "^([^:]+):")
  if dono then
    if dono == usuario then meus = meus + 1 end
    if not disputantes[dono] then
      disputantes[dono] = true
      qtdDisputantes = qtdDisputantes + 1
    end
  end
end

-- Pretendentes recusados há pouco também disputam a capacidade.
for _, pretendente in ipairs(redis.call("ZRANGE", chavePretendentes, 0, -1)) do
  if not disputantes[pretendente] then
    disputantes[pretendente] = true
    qtdDisputantes = qtdDisputantes + 1
  end
end

if not disputantes[usuario] then
  qtdDisputantes = qtdDisputantes + 1
end

local cota = math.ceil(limite / qtdDisputantes)
if cota < 1 then cota = 1 end

local lotado = #ocupados >= limite
local acimaDaCota = meus >= cota

if lotado or acimaDaCota then
  redis.call("ZADD", chavePretendentes, agora + prazoPretendente, usuario)
  redis.call("PEXPIRE", chavePretendentes, prazoPretendente + 60000)
  -- Distingue "não há vaga no tenant" de "sua parte da equipe está cheia".
  if acimaDaCota and not lotado then return -1 end
  return 0
end

redis.call("ZADD", chave, expiraEm, usuario .. ":" .. token)
-- Conseguiu: deixa de ser pretendente, senão continuaria inflando a divisão.
redis.call("ZREM", chavePretendentes, usuario)
-- TTL na chave inteira: se o tenant parar de usar, ela some sozinha em vez de
-- acumular no Redis para sempre.
redis.call("PEXPIRE", chave, expiraEm - agora + 60000)
return 1`;

/**
 * Por quanto tempo um usuário recusado continua contando como disputante.
 *
 * Precisa cobrir o intervalo entre a recusa e a nova tentativa do cliente. Curto
 * demais e o pretendente some antes de conseguir a vaga; longo demais e quem
 * desistiu continua reduzindo a cota dos colegas que ficaram.
 */
const PRAZO_PRETENDENTE_MS = Number(process.env.SLOT_PRETENDENTE_TTL_MS) || 90_000;

/** Motivos de recusa, para o chamador dar a mensagem certa ao usuário. */
export const SLOT_LOTADO = "LOTADO";
export const SLOT_COTA_DO_USUARIO = "COTA_DO_USUARIO";

/**
 * Ocupa um slot do semáforo, respeitando a cota justa do usuário.
 *
 * @param {string} key    identificador do recurso (ex.: `analysis:<tenantId>`)
 * @param {number} limite quantos simultâneos o plano permite ao TENANT
 * @param {number} ttlSeconds prazo máximo de posse do slot
 * @param {string} userId  dono do slot, para a divisão entre colegas de equipe
 * @returns {Promise<{token: string|null, motivo: string|null}>}
 */
export async function acquireSlot(key, limite, ttlSeconds, userId = "anonimo") {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const agora = Date.now();
  // ":" separa dono e token no membro do sorted set, então não pode aparecer no
  // identificador do usuário.
  const dono = String(userId).replace(/:/g, "_");

  const r = await redis.eval(
    ACQUIRE_SLOT_SCRIPT,
    2,
    `slots:${key}`,
    `slots:${key}:pretendentes`,
    agora,
    Math.max(1, limite),
    agora + ttlSeconds * 1000,
    token,
    dono,
    PRAZO_PRETENDENTE_MS
  );

  if (r === 1) return { token: `${dono}:${token}`, motivo: null };
  return { token: null, motivo: r === -1 ? SLOT_COTA_DO_USUARIO : SLOT_LOTADO };
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
