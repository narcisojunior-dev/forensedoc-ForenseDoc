import { prisma } from "../utils/prisma.js";
import { redis } from "../utils/redis.js";

/**
 * Limites operacionais vigentes para um tenant.
 *
 * ─── O que mudou e por quê ───────────────────────────────────────────────────
 *
 * Dois limites nasceram como constante global, calibrados para escritório com um
 * operador só:
 *
 *   mutex de UMA análise por vez por tenant
 *   janela de 30 segundos entre envios (anti-duplo-clique)
 *
 * Nenhum dos dois estava errado para aquele produto. Num cliente B2B com dez
 * funcionários, porém, os dez disputam um slot único, e a janela impõe teto de
 * 120 laudos por hora independentemente da infraestrutura disponível. Viraram
 * atributo do plano: é o cliente que compra capacidade.
 *
 * ─── Defaults preservam o comportamento atual ────────────────────────────────
 *
 * `maxConcurrentAnalyses = 1` e `analysesPerMinute = 2` reproduzem exatamente o
 * mutex e a janela de 30s. Quem já assina não percebe mudança até o plano dele
 * ser ajustado, o que é o comportamento correto para uma migração de schema em
 * base com clientes ativos.
 */

const PADRAO = Object.freeze({
  maxConcurrentAnalyses: 1,
  analysesPerMinute: 2,
});

// Curto de propósito: mudar o plano de um cliente precisa valer em segundos, não
// depois de um deploy. O custo é uma consulta simples por tenant por minuto.
const TTL_SEGUNDOS = Number(process.env.PLAN_LIMITS_CACHE_TTL) || 60;
const chave = (tenantId) => `planlimits:${tenantId}`;

/**
 * @returns {Promise<{maxConcurrentAnalyses: number, analysesPerMinute: number}>}
 */
export async function getPlanLimits(tenantId) {
  if (!tenantId) return { ...PADRAO };

  try {
    const bruto = await redis.get(chave(tenantId));
    if (bruto) return JSON.parse(bruto);
  } catch (err) {
    console.error("[PlanLimits] Leitura de cache falhou:", err.message);
  }

  let limites = { ...PADRAO };
  try {
    const assinatura = await prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        status: true,
        plan: { select: { maxConcurrentAnalyses: true, analysesPerMinute: true } },
      },
    });

    // Só assinatura ATIVA concede a capacidade contratada. Suspensa ou vencida
    // cai no padrão em vez de manter o teto do plano que deixou de ser pago.
    if (assinatura?.status === "ACTIVE" && assinatura.plan) {
      limites = {
        maxConcurrentAnalyses: Math.max(1, assinatura.plan.maxConcurrentAnalyses ?? 1),
        analysesPerMinute: Math.max(1, assinatura.plan.analysesPerMinute ?? 2),
      };
    }
  } catch (err) {
    // Fail-safe pelo lado RESTRITIVO, ao contrário do rate limit: aqui o erro
    // significa conceder capacidade que talvez não tenha sido comprada. O padrão
    // é o comportamento histórico, então ninguém fica pior que antes.
    console.error("[PlanLimits] Falha ao consultar o plano:", err.message);
    return { ...PADRAO };
  }

  try {
    await redis.setex(chave(tenantId), TTL_SEGUNDOS, JSON.stringify(limites));
  } catch (err) {
    console.error("[PlanLimits] Gravação de cache falhou:", err.message);
  }

  return limites;
}

/** Chamada quando o plano do tenant muda, para não esperar o TTL. */
export async function invalidatePlanLimits(tenantId) {
  await redis.del(chave(tenantId)).catch(() => {});
}
