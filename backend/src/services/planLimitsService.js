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
  maxUsers: 1,
});

/*
 * ─── Teto de requisições HTTP, derivado do que o plano vende ─────────────────
 *
 * O `tenantLimiter` era fixo em 200 requisições por minuto POR TENANT, e isso
 * passou a contradizer o próprio produto quando a concorrência virou atributo de
 * plano. Medido nos intervalos reais do cliente:
 *
 *   polling de uma análise em andamento (2s)   30 req/min
 *   polling do histórico (5s)                  12 req/min
 *   sino de notificações (60s)                  1 req/min
 *
 * Oito usuários analisando ao mesmo tempo consomem cerca de 248 req/min e
 * batem no teto. Ou seja: vender um plano de dez análises simultâneas entregaria
 * 429 no uso normal, e o cliente veria a tela falhando sem entender por quê.
 *
 * O limite passa a ser calculado a partir do que foi contratado. Não é
 * afrouxamento: continua sendo um teto, só que proporcional à capacidade vendida
 * em vez de a um número escolhido quando o produto tinha um usuário só.
 */
const CUSTO = Object.freeze({
  // Uma análise em andamento faz uma consulta de status a cada 2 segundos.
  porAnaliseSimultanea: 30,
  // Navegação, histórico e notificações de um usuário ativo.
  porAssento: 20,
  // Folga para picos de navegação que não dependem de assento nem de análise.
  base: 60,
});

/**
 * Nunca abaixo do teto histórico: um tenant existente não pode ficar PIOR do que
 * era por causa desta mudança. É a mesma regra de migração que os defaults de
 * `maxConcurrentAnalyses` seguem.
 */
const TETO_HTTP_MINIMO = 200;

export function httpBudget({ maxConcurrentAnalyses, analysesPerMinute, maxUsers }) {
  const calculado =
    CUSTO.base +
    CUSTO.porAssento * (maxUsers || 1) +
    CUSTO.porAnaliseSimultanea * (maxConcurrentAnalyses || 1) +
    // A vazão contratada também gera requisições de envio.
    (analysesPerMinute || 1);
  return Math.max(TETO_HTTP_MINIMO, calculado);
}

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
        plan: {
          select: {
            maxConcurrentAnalyses: true,
            analysesPerMinute: true,
            maxUsers: true,
          },
        },
      },
    });

    // Só assinatura ATIVA concede a capacidade contratada. Suspensa ou vencida
    // cai no padrão em vez de manter o teto do plano que deixou de ser pago.
    if (assinatura?.status === "ACTIVE" && assinatura.plan) {
      limites = {
        maxConcurrentAnalyses: Math.max(1, assinatura.plan.maxConcurrentAnalyses ?? 1),
        analysesPerMinute: Math.max(1, assinatura.plan.analysesPerMinute ?? 2),
        maxUsers: Math.max(1, assinatura.plan.maxUsers ?? 1),
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
