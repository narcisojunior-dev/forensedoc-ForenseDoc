import { prisma } from "../utils/prisma.js";
import { invalidateCreditCache } from "../services/creditService.js";

export async function processCreditExpirations() {
  console.log("[Jobs:expireCredits] Iniciando verificação de expiração de créditos mensais...");
  
  const now = new Date();

  try {
    // Busca todos os saldos que têm ciclo vencido e ainda possuem créditos mensais
    const expiredBalances = await prisma.creditBalance.findMany({
      where: {
        cycleEnd: { lte: now },
        creditsMonthly: { gt: 0 }
      }
    });

    if (expiredBalances.length === 0) {
      console.log("[Jobs:expireCredits] Nenhum crédito a expirar hoje.");
      return;
    }

    console.log(`[Jobs:expireCredits] Encontrados ${expiredBalances.length} tenants com créditos expirados.`);

    for (const balance of expiredBalances) {
      await prisma.$transaction(async (tx) => {
        const lostCredits = balance.creditsMonthly;

        // 1. Zerar o saldo mensal
        await tx.creditBalance.update({
          where: { tenantId: balance.tenantId },
          data: { creditsMonthly: 0 }
        });

        // 2. Registrar a transação de expiração (saída)
        await tx.creditTransaction.create({
          data: {
            tenantId: balance.tenantId,
            type: "EXPIRE",
            amount: -lostCredits,
            creditType: "monthly",
            source: "subscription_renewal", // expirou pq o ciclo virou/encerrou
            notes: "Créditos mensais não utilizados expirados no fim do ciclo"
          }
        });
      });

      // Invalidar cache do tenant
      await invalidateCreditCache(balance.tenantId);
    }

    console.log("[Jobs:expireCredits] Verificação concluída com sucesso.");
  } catch (error) {
    console.error("[Jobs:expireCredits] Erro durante processamento de expiração:", error);
    throw error; // Repassa pro BullMQ registrar a falha
  }
}
