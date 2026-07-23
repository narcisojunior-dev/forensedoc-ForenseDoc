import { prisma } from "../utils/prisma.js";
import * as creditService from "../services/creditService.js";
import { notify } from "../services/notificationService.js";
import { saasQueue } from "../queues.js";

export async function processWebhook(job) {
  const { event, payment, subscription } = job.data;

  switch (event) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED":
      await handlePaymentReceived(payment);
      break;
    case "PAYMENT_OVERDUE":
      await handlePaymentOverdue(payment);
      break;
    case "SUBSCRIPTION_CANCELLED":
      await handleSubscriptionCancelled(subscription);
      break;
    default:
      console.log(`[Webhook] Evento não tratado: ${event}`);
  }
}

async function getTenantByAsaasCustomerId(asaasCustomerId) {
  return prisma.tenant.findFirst({ where: { asaasCustomerId } });
}

async function handlePaymentReceived(payment) {
  if (!payment) return;

  // Idempotência: nunca processar o mesmo pagamento duas vezes.
  const existing = await prisma.payment.findUnique({
    where: { asaasPaymentId: payment.id },
  });
  if (existing?.status === "PAID") {
    console.log(`[Webhook] Payment ${payment.id} já processado, ignorando.`);
    return;
  }

  const tenant = await getTenantByAsaasCustomerId(payment.customer);
  if (!tenant) {
    console.error(`[Webhook] Tenant não encontrado para asaasCustomerId ${payment.customer}`);
    return;
  }

  // Cobranças geradas automaticamente pela assinatura na Asaas não têm uma
  // linha local pré-existente (só a compra avulsa cria uma via /billing/avulso
  // antes do pagamento acontecer) — upsert cobre os dois casos.
  const updated = await prisma.payment.upsert({
    where: { asaasPaymentId: payment.id },
    update: { status: "PAID", paidAt: new Date() },
    create: {
      tenantId: tenant.id,
      amountBrl: payment.value,
      type: payment.subscription ? "SUBSCRIPTION" : "AVULSO",
      status: "PAID",
      asaasPaymentId: payment.id,
      asaasBillingType: payment.billingType,
      paidAt: new Date(),
    },
  });

  if (updated.type === "SUBSCRIPTION") {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: tenant.id },
      include: { plan: true },
    });
    if (subscription) {
      const newPeriodStart = new Date();
      const newPeriodEnd = new Date(newPeriodStart);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + (subscription.isAnnual ? 12 : 1));

      // Avança o ciclo a cada pagamento confirmado — sem isso,
      // wasEmergencyGrantedThisCycle compararia sempre contra a data de
      // criação original da assinatura, nunca "esquecendo" uma emergência
      // concedida em ciclos anteriores.
      await prisma.subscription.update({
        where: { tenantId: tenant.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
        },
      });

      await creditService.addMonthlyCredits(
        tenant.id,
        subscription.plan.creditsMonthly,
        newPeriodStart,
        newPeriodEnd
      );
      await creditService.expireEmergencyCredits(tenant.id);

      await notify({
        tenantId: tenant.id,
        type: "PAYMENT_CONFIRMED",
        title: "Pagamento confirmado",
        body: `Seus ${subscription.plan.creditsMonthly} laudos do plano ${subscription.plan.name} já estão disponíveis.`,
        emailData: {
          planName: subscription.plan.name,
          credits: subscription.plan.creditsMonthly,
        },
      });
    }
  } else {
    // AVULSO ou EXCESS
    await creditService.addAvulsoCredit(tenant.id, updated.id);

    await notify({
      tenantId: tenant.id,
      type: "PAYMENT_CONFIRMED",
      title: "Laudo avulso liberado",
      body: "Seu pagamento foi confirmado e o laudo avulso já está no seu saldo. Ele não expira.",
      emailData: { planName: "Laudo avulso", credits: 1 },
    });
  }
}

async function handlePaymentOverdue(payment) {
  if (!payment) return;

  const tenant = await getTenantByAsaasCustomerId(payment.customer);
  if (!tenant) {
    console.error(`[Webhook] Tenant não encontrado para asaasCustomerId ${payment.customer}`);
    return;
  }

  const alreadyGranted = await creditService.wasEmergencyGrantedThisCycle(tenant.id);
  if (!alreadyGranted) {
    await creditService.addEmergencyCredits(tenant.id);

    // Só notifica junto da concessão: o mesmo guard de idempotência evita
    // um e-mail a cada reenvio do webhook PAYMENT_OVERDUE pela Asaas.
    await notify({
      tenantId: tenant.id,
      type: "PAYMENT_FAILED",
      title: "Pagamento não aprovado",
      body: "Liberamos 2 laudos de emergência. Regularize em até 7 dias para evitar a suspensão da conta.",
      emailData: { invoiceUrl: payment.invoiceUrl || payment.bankSlipUrl || null },
    });
  }

  await prisma.payment.upsert({
    where: { asaasPaymentId: payment.id },
    update: { status: "OVERDUE" },
    create: {
      tenantId: tenant.id,
      amountBrl: payment.value,
      type: payment.subscription ? "SUBSCRIPTION" : "AVULSO",
      status: "OVERDUE",
      asaasPaymentId: payment.id,
      asaasBillingType: payment.billingType,
      dueDate: payment.dueDate ? new Date(payment.dueDate) : undefined,
    },
  });

  await prisma.subscription
    .update({ where: { tenantId: tenant.id }, data: { status: "OVERDUE" } })
    .catch(() => {});

  await saasQueue.add(
    "suspend-if-overdue",
    { tenantId: tenant.id },
    { delay: 7 * 24 * 60 * 60 * 1000 }
  );
}

async function handleSubscriptionCancelled(subscription) {
  if (!subscription) return;

  const tenant = await prisma.tenant.findFirst({
    where: { subscription: { asaasSubscriptionId: subscription.id } },
  });
  if (!tenant) {
    console.error(`[Webhook] Tenant não encontrado para asaasSubscriptionId ${subscription.id}`);
    return;
  }

  await prisma.subscription.update({
    where: { tenantId: tenant.id },
    data: { status: "CANCELLED" },
  });
}

export async function suspendIfStillOverdue(tenantId) {
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (subscription?.status === "OVERDUE") {
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
    console.log(`[Webhook] Tenant ${tenantId} suspenso após 7 dias em atraso.`);

    await notify({
      tenantId,
      type: "ACCOUNT_SUSPENDED",
      title: "Conta suspensa",
      body: "Sua conta foi suspensa por falta de pagamento. Regularize para reativar o acesso às análises.",
    });
  }
}
