import { prisma } from "../utils/prisma.js";
import { redis } from "../utils/redis.js";

const CREDIT_CACHE_TTL = 30; // segundos
const getCacheKey = (tenantId) => `credits:${tenantId}`;

export async function getCreditBalance(tenantId) {
  const cacheKey = getCacheKey(tenantId);
  const cached = await redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const balance = await prisma.creditBalance.findUnique({
    where: { tenantId },
  });

  if (balance) {
    await redis.setex(cacheKey, CREDIT_CACHE_TTL, JSON.stringify(balance));
  }
  
  return balance;
}

export async function invalidateCreditCache(tenantId) {
  await redis.del(getCacheKey(tenantId));
}

export function getTotalCredits(balance) {
  if (!balance) return 0;
  return balance.creditsMonthly + balance.creditsEmergency + balance.creditsAvulso + balance.creditsManual;
}

export async function hasCredit(tenantId) {
  const balance = await getCreditBalance(tenantId);
  return getTotalCredits(balance) > 0;
}

export async function getBalancePublic(tenantId) {
  const balance = await getCreditBalance(tenantId);
  return {
    total: getTotalCredits(balance),
    details: {
      monthly: balance?.creditsMonthly || 0,
      avulso: balance?.creditsAvulso || 0,
      emergency: balance?.creditsEmergency || 0,
      manual: balance?.creditsManual || 0,
    }
  };
}

export async function debitCredit(tenantId, userId, analysisId, txClient = prisma) {
  const balance = await txClient.creditBalance.findUnique({
    where: { tenantId },
  });

  if (getTotalCredits(balance) < 1) {
    throw new Error("INSUFFICIENT_CREDITS");
  }

  let updateField;
  let creditTypeUsed;

  // Ordem de prioridade de gasto: Mensal -> Emergência -> Avulso/Manual
  if (balance.creditsMonthly > 0) {
    updateField = { creditsMonthly: { decrement: 1 } };
    creditTypeUsed = "monthly";
  } else if (balance.creditsEmergency > 0) {
    updateField = { creditsEmergency: { decrement: 1 } };
    creditTypeUsed = "emergency";
  } else if (balance.creditsAvulso > 0) {
    updateField = { creditsAvulso: { decrement: 1 } };
    creditTypeUsed = "avulso";
  } else {
    updateField = { creditsManual: { decrement: 1 } };
    creditTypeUsed = "manual";
  }

  const [, creditTx] = await Promise.all([
    txClient.creditBalance.update({
      where: { tenantId },
      data: updateField,
    }),
    txClient.creditTransaction.create({
      data: {
        tenantId,
        userId,
        type: "SPEND",
        amount: -1,
        creditType: creditTypeUsed,
        source: "analysis",
        analysisId,
      },
    })
  ]);

  await invalidateCreditCache(tenantId);
  
  // Opcional: disparar verificação assíncrona de alertas (Módulo 7)
  // setImmediate(() => checkCreditAlerts(tenantId, balance));

  return creditTx;
}

export async function refundCredit(tenantId, userId, analysisId, reason = "Erro na análise") {
  return await prisma.$transaction(async (tx) => {
    // Achar a transação original de gasto para saber o tipo de crédito
    const originalTx = await tx.creditTransaction.findFirst({
      where: { tenantId, analysisId, type: "SPEND" }
    });

    if (!originalTx) {
      throw new Error("ORIGINAL_TRANSACTION_NOT_FOUND");
    }

    // Verificar se já foi estornado
    const alreadyRefunded = await tx.creditTransaction.findFirst({
      where: { tenantId, analysisId, type: "REFUND" }
    });

    if (alreadyRefunded) return; // Idempotência

    let updateField;
    if (originalTx.creditType === "monthly") updateField = { creditsMonthly: { increment: 1 } };
    else if (originalTx.creditType === "emergency") updateField = { creditsEmergency: { increment: 1 } };
    else if (originalTx.creditType === "avulso") updateField = { creditsAvulso: { increment: 1 } };
    else updateField = { creditsManual: { increment: 1 } };

    await tx.creditBalance.update({
      where: { tenantId },
      data: updateField,
    });

    await tx.creditTransaction.create({
      data: {
        tenantId,
        userId,
        type: "REFUND",
        amount: 1,
        creditType: originalTx.creditType,
        source: "refund",
        analysisId,
        notes: reason,
      },
    });

    // Atualiza status da análise para REFUNDED se aplicável (opcional dependendo da lógica do Módulo 4)
    await tx.analysis.update({
      where: { id: analysisId },
      data: { status: "REFUNDED" },
    }).catch(() => {}); // Ignora erro se análise já foi deletada

    await invalidateCreditCache(tenantId);
  });
}
