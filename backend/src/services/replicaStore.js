import { redis } from "../utils/redis.js";

/**
 * Registro das réplicas processuais.
 *
 * ─── Por que Redis com prazo, e não uma tabela ───────────────────────────────
 *
 * A réplica é trabalho de redação em andamento: o advogado sobe os autos, confere
 * os achados, escolhe o cenário e leva a minuta para o editor. O que tem valor
 * duradouro é a peça protocolada, que não mora aqui. Guardar autos processuais
 * de terceiros por tempo indeterminado seria dado pessoal retido sem finalidade
 * (LGPD, art. 15), e criar tabela nova alteraria o esquema do SaaS para algo que
 * expira por natureza.
 *
 * O prazo é configurável por `REPLICA_RETENTION_HOURS` (padrão de 7 dias), e o
 * usuário pode apagar a qualquer momento. Os arquivos enviados não ficam aqui:
 * são apagados do armazenamento assim que o job termina.
 */

export const REPLICA_TTL_SECONDS = Math.max(1, Number(process.env.REPLICA_RETENTION_HOURS) || 168) * 3600;

const chaveRegistro = (tenantId, id) => `replica:${tenantId}:${id}`;
const chaveIndice = (tenantId) => `replicas:${tenantId}`;

export async function salvarReplica(tenantId, registro) {
  const agora = Date.now();
  const multi = redis.multi();
  multi.set(chaveRegistro(tenantId, registro.id), JSON.stringify(registro), "EX", REPLICA_TTL_SECONDS);
  multi.zadd(chaveIndice(tenantId), new Date(registro.createdAt).getTime() || agora, registro.id);
  // O índice não pode sobreviver aos registros: descarta entradas vencidas.
  multi.zremrangebyscore(chaveIndice(tenantId), "-inf", agora - REPLICA_TTL_SECONDS * 1000);
  multi.expire(chaveIndice(tenantId), REPLICA_TTL_SECONDS);
  await multi.exec();
  return registro;
}

export async function lerReplica(tenantId, id) {
  const bruto = await redis.get(chaveRegistro(tenantId, id));
  if (!bruto) return null;
  try {
    return JSON.parse(bruto);
  } catch {
    return null;
  }
}

/**
 * Atualiza um registro existente preservando o prazo de expiração original:
 * editar a minuta não pode estender a retenção dos dados indefinidamente.
 */
export async function atualizarReplica(tenantId, id, alterar) {
  const atual = await lerReplica(tenantId, id);
  if (!atual) return null;
  const novo = { ...atual, ...alterar(atual), updatedAt: new Date().toISOString() };
  const ttl = await redis.ttl(chaveRegistro(tenantId, id));
  await redis.set(chaveRegistro(tenantId, id), JSON.stringify(novo), "EX", ttl > 0 ? ttl : REPLICA_TTL_SECONDS);
  return novo;
}

export async function listarReplicas(tenantId, limite = 20) {
  const ids = await redis.zrevrange(chaveIndice(tenantId), 0, Math.max(0, limite - 1));
  if (!ids.length) return [];
  const brutos = await redis.mget(ids.map((id) => chaveRegistro(tenantId, id)));
  const registros = [];
  const vencidos = [];
  brutos.forEach((bruto, indice) => {
    if (!bruto) return vencidos.push(ids[indice]);
    try {
      registros.push(JSON.parse(bruto));
    } catch {
      vencidos.push(ids[indice]);
    }
  });
  if (vencidos.length) await redis.zrem(chaveIndice(tenantId), ...vencidos).catch(() => {});
  return registros;
}

export async function apagarReplica(tenantId, id) {
  const multi = redis.multi();
  multi.del(chaveRegistro(tenantId, id));
  multi.zrem(chaveIndice(tenantId), id);
  const [[, removidos]] = await multi.exec();
  return removidos > 0;
}
