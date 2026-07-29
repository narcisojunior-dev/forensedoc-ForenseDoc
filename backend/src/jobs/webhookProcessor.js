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

/**
 * Marca o pagamento como PAID e devolve a linha APENAS para quem realizou a
 * transição — `null` para todos os outros.
 *
 * O par `findUnique` + `upsert` que existia aqui não era idempotente de fato:
 * a Asaas envia PAYMENT_RECEIVED e PAYMENT_CONFIRMED para a mesma cobrança e a
 * fila ainda tem `attempts: 5`, então duas execuções concorrentes liam o mesmo
 * estado "ainda não pago", ambas passavam pelo guard e ambas creditavam.
 *
 * A reivindicação agora é atômica sem precisar subir o nível de isolamento:
 *   - `updateMany` com `status: { not: "PAID" }` no WHERE resolve o caso da
 *     linha já existente — o banco serializa as duas escritas na mesma linha e
 *     só uma vê `count === 1`;
 *   - o `create` cobre a cobrança gerada pela assinatura na Asaas, que não tem
 *     linha local prévia (só a compra avulsa cria uma via /billing/avulso). Em
 *     corrida, a constraint única de `asaasPaymentId` derruba a segunda com
 *     P2002, que aqui significa "outra execução já reivindicou".
 */
async function claimPayment(payment, tenant) {
  const paidAt = new Date();

  const { count } = await prisma.payment.updateMany({
    where: { asaasPaymentId: payment.id, status: { not: "PAID" } },
    data: { status: "PAID", paidAt },
  });

  if (count === 1) {
    return prisma.payment.findUnique({ where: { asaasPaymentId: payment.id } });
  }

  // count === 0: ou a linha já estava PAID, ou ela ainda não existe.
  const existing = await prisma.payment.findUnique({
    where: { asaasPaymentId: payment.id },
  });
  if (existing) {
    console.log(`[Webhook] Payment ${payment.id} já processado, ignorando.`);
    return null;
  }

  try {
    return await prisma.payment.create({
      data: {
        tenantId: tenant.id,
        amountBrl: payment.value,
        type: payment.subscription ? "SUBSCRIPTION" : "AVULSO",
        status: "PAID",
        asaasPaymentId: payment.id,
        asaasBillingType: payment.billingType,
        paidAt,
      },
    });
  } catch (err) {
    if (err.code === "P2002") {
      console.log(`[Webhook] Payment ${payment.id} criado em paralelo, ignorando.`);
      return null;
    }
    throw err;
  }
}

async function handlePaymentReceived(payment) {
  if (!payment) return;

  const tenant = await getTenantByAsaasCustomerId(payment.customer);
  if (!tenant) {
    console.error(`[Webhook] Tenant não encontrado para asaasCustomerId ${payment.customer}`);
    return;
  }

  // Só quem reivindicou o pagamento credita. Sem isso, uma entrega duplicada
  // gerava crédito duplicado sem pagamento correspondente.
  const updated = await claimPayment(payment, tenant);
  if (!updated) return;

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
    // AVULSO
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
