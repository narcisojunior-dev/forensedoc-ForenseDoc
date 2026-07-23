import { prisma } from "../utils/prisma.js";
import { notify } from "../services/notificationService.js";

/**
 * Crons diários de notificação (Módulo 7 — M7.3).
 *
 * Ambos são idempotentes por dia: antes de notificar, verificam se já existe
 * uma notificação do mesmo tipo para aquele tenant nas últimas 24h. Sem isso,
 * um restart do worker que reprocessasse o cron mandaria e-mail duplicado.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function alreadyNotifiedToday(tenantId, type) {
  const since = new Date(Date.now() - DAY_MS);
  const count = await prisma.notification.count({
    where: { tenantId, type, createdAt: { gte: since } },
  });
  return count > 0;
}

function formatDateBr(date) {
  return new Date(date).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Assinaturas que renovam daqui a 3 dias → RENEWAL_REMINDER. */
export async function processRenewalReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 3 * DAY_MS);
  const windowEnd = new Date(now.getTime() + 4 * DAY_MS);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      currentPeriodEnd: { gte: windowStart, lt: windowEnd },
    },
    include: { plan: true },
  });

  console.log(`[Jobs:reminders] ${subscriptions.length} assinatura(s) renovando em 3 dias.`);

  for (const sub of subscriptions) {
    if (await alreadyNotifiedToday(sub.tenantId, "RENEWAL_REMINDER")) continue;

    await notify({
      tenantId: sub.tenantId,
      type: "RENEWAL_REMINDER",
      title: "Sua assinatura renova em 3 dias",
      body: `O plano ${sub.plan.name} renova em ${formatDateBr(sub.currentPeriodEnd)}. Laudos mensais não usados expiram na virada do ciclo.`,
      emailData: {
        planName: sub.plan.name,
        renewalDate: formatDateBr(sub.currentPeriodEnd),
        amount: Number(sub.plan.priceBrl).toFixed(2).replace(".", ","),
      },
    });
  }
}

/**
 * Assinaturas em atraso há 3+ dias e ainda não suspensas → aviso de urgência.
 * A suspensão em si continua no job 'suspend-if-overdue' agendado pelo webhook.
 */
export async function processOverdueReminders() {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: "OVERDUE",
      tenant: { status: { not: "SUSPENDED" } },
    },
    include: { tenant: true },
  });

  const now = Date.now();

  for (const sub of subscriptions) {
    const daysOverdue = Math.floor((now - new Date(sub.currentPeriodEnd).getTime()) / DAY_MS);
    if (daysOverdue < 3) continue;

    if (await alreadyNotifiedToday(sub.tenantId, "PAYMENT_FAILED")) continue;

    await notify({
      tenantId: sub.tenantId,
      type: "PAYMENT_FAILED",
      title: `Pagamento em atraso há ${daysOverdue} dias`,
      body: "Regularize o pagamento para evitar a suspensão automática da conta em 7 dias.",
      template: "PAYMENT_OVERDUE_URGENT",
      emailData: { daysOverdue },
    });
  }

  console.log(`[Jobs:reminders] Verificação de atrasos concluída (${subscriptions.length} em atraso).`);
}
