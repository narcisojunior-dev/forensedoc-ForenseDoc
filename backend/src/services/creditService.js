import { prisma } from "../utils/prisma.js";
import { redis } from "../utils/redis.js";
import { notify } from "./notificationService.js";

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

  await checkCreditAlerts(tenantId, balance);

  return creditTx;
}

export async function getActiveSubscription(tenantId) {
  return prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
}

// Dispara no máximo um alerta in-app por débito, com base no saldo mensal
// ANTES do decremento — a comparação com o limiar detecta a transição exata
// (ex.: 1 crédito restante -> 0), evitando notificações duplicadas em débitos
// subsequentes que já estão abaixo do limiar.
export async function checkCreditAlerts(tenantId, balanceBefore) {
  const subscription = await getActiveSubscription(tenantId);
  if (!subscription || subscription.status !== "ACTIVE") return;

  const totalMonthly = subscription.plan.creditsMonthly;
  if (!totalMonthly) return;

  const used = totalMonthly - balanceBefore.creditsMonthly;
  const pct = (used / totalMonthly) * 100;

  let type = null;
  if (pct >= 100 && balanceBefore.creditsMonthly > 0) {
    type = "CREDITS_EXHAUSTED";
  } else if (pct >= 95 && balanceBefore.creditsMonthly > Math.ceil(totalMonthly * 0.05)) {
    type = "CREDITS_95PCT";
  } else if (pct >= 80 && balanceBefore.creditsMonthly > Math.ceil(totalMonthly * 0.20)) {
    type = "CREDITS_80PCT";
  }
  if (!type) return;

  const ALERT_COPY = {
    CREDITS_80PCT: { title: "80% dos laudos utilizados", body: "Você já usou 80% dos seus laudos mensais." },
    CREDITS_95PCT: { title: "Poucos laudos restantes", body: "Restam poucos laudos disponíveis neste ciclo." },
    CREDITS_EXHAUSTED: { title: "Créditos esgotados", body: "Seus laudos mensais acabaram. Recarregue para continuar." },
  };

  await notify({
    tenantId,
    type,
    title: ALERT_COPY[type].title,
    body: ALERT_COPY[type].body,
    // O saldo já foi decrementado quando este alerta dispara.
    emailData: { remaining: Math.max(balanceBefore.creditsMonthly - 1, 0), total: totalMonthly },
  });
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

// Créditos mensais (renovação de assinatura confirmada pelo webhook da Asaas).
export async function addMonthlyCredits(tenantId, amount, cycleStart, cycleEnd) {
  await prisma.$transaction([
    prisma.creditBalance.update({
      where: { tenantId },
      data: { creditsMonthly: { increment: amount }, cycleStart, cycleEnd },
    }),
    prisma.creditTransaction.create({
      data: {
        tenantId,
        type: "EARN_MONTHLY",
        amount,
        creditType: "monthly",
        source: "subscription_renewal",
      },
    }),
  ]);
  await invalidateCreditCache(tenantId);
}

// Crédito avulso (compra confirmada pelo webhook da Asaas).
export async function addAvulsoCredit(tenantId, paymentId) {
  await prisma.$transaction([
    prisma.creditBalance.update({
      where: { tenantId },
      data: { creditsAvulso: { increment: 1 } },
    }),
    prisma.creditTransaction.create({
      data: {
        tenantId,
        type: "EARN_AVULSO",
        amount: 1,
        creditType: "avulso",
        source: "avulso_purchase",
        notes: `Payment ${paymentId}`,
      },
    }),
  ]);
  await invalidateCreditCache(tenantId);
}

// Créditos de emergência (falha de cobrança) — 2 créditos, sem cobrança.
export async function addEmergencyCredits(tenantId) {
  await prisma.$transaction([
    prisma.creditBalance.update({
      where: { tenantId },
      data: { creditsEmergency: { increment: 2 } },
    }),
    prisma.creditTransaction.create({
      data: {
        tenantId,
        type: "EARN_EMERGENCY",
        amount: 2,
        creditType: "emergency",
        source: "payment_failure",
      },
    }),
    prisma.subscription.update({
      where: { tenantId },
      data: { emergencyGrantedAt: new Date() },
    }),
  ]);
  await invalidateCreditCache(tenantId);
}

// Expira créditos de emergência não usados ao regularizar o pagamento.
export async function expireEmergencyCredits(tenantId) {
  const balance = await prisma.creditBalance.findUnique({ where: { tenantId } });
  if (!balance || balance.creditsEmergency <= 0) return;

  await prisma.$transaction([
    prisma.creditBalance.update({
      where: { tenantId },
      data: { creditsEmergency: 0 },
    }),
    prisma.creditTransaction.create({
      data: {
        tenantId,
        type: "EXPIRE",
        amount: -balance.creditsEmergency,
        creditType: "emergency",
        source: "payment_regularized",
      },
    }),
  ]);
  await invalidateCreditCache(tenantId);
}

// Evita conceder emergência duas vezes no mesmo ciclo de cobrança.
export async function wasEmergencyGrantedThisCycle(tenantId) {
  const subscription = await getActiveSubscription(tenantId);
  if (!subscription?.emergencyGrantedAt) return false;
  return subscription.emergencyGrantedAt >= subscription.currentPeriodStart;
}
