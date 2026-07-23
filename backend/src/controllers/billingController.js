import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import * as asaasService from "../services/asaasService.js";
import { countOccupiedSeats } from "./tenantController.js";

// Guard reutilizado nas rotas financeiras: o titular contrata e paga, os
// membros convidados apenas consomem os créditos do escritório.
function ensureOwner(req, res, acao) {
  if (req.auth.role !== "OWNER") {
    res.status(403).json({ error: `Apenas o proprietário pode ${acao}.` });
    return false;
  }
  return true;
}

const billingTypeSchema = z.enum(["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"]);

const subscribeSchema = z.object({
  planId: z.string().min(1),
  billingType: billingTypeSchema,
  isAnnual: z.boolean().optional().default(false),
  founderInviteCode: z.string().optional(),
});

const avulsoSchema = z.object({
  billingType: billingTypeSchema,
});

const AVULSO_PRICE_BRL = 79.0;

export async function getPlans(_req, res) {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceBrl: "asc" },
    });
    return res.json({ plans });
  } catch (error) {
    console.error("[Billing] Erro ao listar planos:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

async function ensureAsaasCustomer(tenant) {
  if (tenant.asaasCustomerId) return tenant.asaasCustomerId;
  const customer = await asaasService.createAsaasCustomer(tenant);
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { asaasCustomerId: customer.id },
  });
  return customer.id;
}

export async function subscribe(req, res) {
  try {
    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode assinar um plano." });
    }

    const { planId, billingType, isAnnual, founderInviteCode } = subscribeSchema.parse(req.body);
    const tenantId = req.tenantId;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const existing = await prisma.subscription.findUnique({ where: { tenantId } });
    if (existing) {
      return res.status(400).json({ error: "Tenant já possui assinatura ativa. Use o endpoint de upgrade." });
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) {
      return res.status(404).json({ error: "Plano não encontrado." });
    }

    let founderInvite = null;
    if (plan.isFounder) {
      if (!founderInviteCode) {
        return res.status(400).json({ error: "Este plano exige um código de convite de fundador." });
      }
      founderInvite = await prisma.founderInvite.findUnique({ where: { code: founderInviteCode } });
      if (!founderInvite || founderInvite.usedAt) {
        return res.status(400).json({ error: "Código de convite inválido ou já utilizado." });
      }
      if (!plan.founderSlotsRemaining || plan.founderSlotsRemaining <= 0) {
        return res.status(400).json({ error: "Vagas de fundador esgotadas." });
      }
    }

    const asaasCustomerId = await ensureAsaasCustomer(tenant);
    const asaasSubscription = await asaasService.createSubscription(asaasCustomerId, plan, billingType, isAnnual);

    const now = new Date();
    const currentPeriodEnd = new Date(now);
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + (isAnnual ? 12 : 1));

    const founderLockedUntil = new Date(now);
    founderLockedUntil.setMonth(founderLockedUntil.getMonth() + 12);

    const subscription = await prisma.$transaction(async (tx) => {
      if (founderInvite) {
        await tx.founderInvite.update({
          where: { id: founderInvite.id },
          data: { usedAt: now, tenantId },
        });
        await tx.plan.update({
          where: { id: plan.id },
          data: { founderSlotsRemaining: { decrement: 1 } },
        });
      }

      const created = await tx.subscription.create({
        data: {
          tenantId,
          planId: plan.id,
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd,
          asaasSubscriptionId: asaasSubscription.id,
          isAnnual,
          founderLocked: plan.isFounder,
          founderLockedUntil: plan.isFounder ? founderLockedUntil : null,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.auth.userId,
          action: "subscription_created",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { planId: plan.id, billingType, isAnnual },
        },
      });

      return created;
    });

    return res.status(201).json({ subscription });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    if (error.name === "AsaasError") return res.status(502).json({ error: error.message });
    console.error("[Billing] Erro ao assinar plano:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function purchaseAvulso(req, res) {
  try {
    if (!ensureOwner(req, res, "comprar créditos")) return;
    const { billingType } = avulsoSchema.parse(req.body);
    const tenantId = req.tenantId;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const asaasCustomerId = await ensureAsaasCustomer(tenant);

    const asaasPayment = await asaasService.createAvulsoPayment(asaasCustomerId, AVULSO_PRICE_BRL, billingType);

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          tenantId,
          amountBrl: AVULSO_PRICE_BRL,
          type: "AVULSO",
          status: "PENDING",
          asaasPaymentId: asaasPayment.id,
          asaasBillingType: billingType,
          dueDate: asaasPayment.dueDate ? new Date(asaasPayment.dueDate) : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.auth.userId,
          action: "avulso_purchase_created",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { paymentId: created.id, billingType },
        },
      });

      return created;
    });

    return res.status(201).json({
      payment,
      invoiceUrl: asaasPayment.invoiceUrl,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    if (error.name === "AsaasError") return res.status(502).json({ error: error.message });
    console.error("[Billing] Erro ao comprar crédito avulso:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getSubscription(req, res) {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: req.tenantId },
      include: { plan: true },
    });
    return res.json({ subscription });
  } catch (error) {
    console.error("[Billing] Erro ao buscar assinatura:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function upgradeSubscription(req, res) {
  try {
    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode alterar o plano." });
    }

    const { planId } = z.object({ planId: z.string().min(1) }).parse(req.body);
    const tenantId = req.tenantId;

    const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!subscription) return res.status(404).json({ error: "Nenhuma assinatura ativa encontrada." });

    if (subscription.founderLocked && subscription.founderLockedUntil > new Date()) {
      return res.status(403).json({
        error: `Plano fundador travado até ${subscription.founderLockedUntil.toISOString().slice(0, 10)}.`,
      });
    }

    const newPlan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!newPlan || !newPlan.isActive || newPlan.isFounder) {
      return res.status(404).json({ error: "Plano não encontrado." });
    }

    // Downgrade não pode deixar a equipe acima do limite do plano novo.
    // Verificado ANTES de tocar na Asaas: cancelar a assinatura atual para
    // só então descobrir que o plano não cabe deixaria o cliente sem nada.
    const seats = await countOccupiedSeats(tenantId);
    if (seats.total > newPlan.maxUsers) {
      return res.status(409).json({
        error:
          `O plano ${newPlan.name} permite ${newPlan.maxUsers} usuário(s), mas o escritório tem ` +
          `${seats.users} na equipe` +
          (seats.pendingInvites > 0 ? ` e ${seats.pendingInvites} convite(s) pendente(s)` : "") +
          `. Remova os excedentes antes de trocar de plano.`,
        code: "PLAN_USER_LIMIT_EXCEEDED",
        limit: newPlan.maxUsers,
        ...seats,
      });
    }

    // Cancela a assinatura atual na Asaas e cria uma nova com o novo valor —
    // mais simples e confiável do que tentar editar o valor in-place.
    if (subscription.asaasSubscriptionId) {
      await asaasService.cancelSubscription(subscription.asaasSubscriptionId).catch((err) => {
        console.error("[Billing] Aviso: falha ao cancelar assinatura antiga na Asaas:", err.message);
      });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const asaasCustomerId = await ensureAsaasCustomer(tenant);
    const asaasSubscription = await asaasService.createSubscription(
      asaasCustomerId,
      newPlan,
      "UNDEFINED",
      subscription.isAnnual
    );

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { tenantId },
        data: {
          planId: newPlan.id,
          asaasSubscriptionId: asaasSubscription.id,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.auth.userId,
          action: "subscription_upgraded",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { newPlanId: newPlan.id },
        },
      });

      return result;
    });

    return res.json({ subscription: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    if (error.name === "AsaasError") return res.status(502).json({ error: error.message });
    console.error("[Billing] Erro ao fazer upgrade de plano:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function cancelSubscription(req, res) {
  try {
    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode cancelar a assinatura." });
    }

    const tenantId = req.tenantId;
    const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!subscription) return res.status(404).json({ error: "Nenhuma assinatura ativa encontrada." });

    if (subscription.asaasSubscriptionId) {
      await asaasService.cancelSubscription(subscription.asaasSubscriptionId).catch((err) => {
        console.error("[Billing] Aviso: falha ao cancelar assinatura na Asaas:", err.message);
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { tenantId },
        data: { status: "CANCELLED" },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req.auth.userId,
          action: "subscription_cancelled",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      });

      return result;
    });

    return res.json({ subscription: updated });
  } catch (error) {
    console.error("[Billing] Erro ao cancelar assinatura:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getPayments(req, res) {
  try {
    if (!ensureOwner(req, res, "ver o histórico de pagamentos")) return;
    const tenantId = req.tenantId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where: { tenantId } }),
    ]);

    return res.json({
      payments,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[Billing] Erro ao buscar pagamentos:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getInvoice(req, res) {
  try {
    if (!ensureOwner(req, res, "acessar a cobrança")) return;
    const tenantId = req.tenantId;
    const payment = await prisma.payment.findFirst({
      where: { tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) return res.status(404).json({ error: "Nenhuma cobrança pendente encontrada." });

    // invoiceUrl/pix não são persistidos localmente — buscar direto na Asaas.
    const asaasPayment = await asaasService.getPayment(payment.asaasPaymentId);

    return res.json({
      payment,
      invoiceUrl: asaasPayment.invoiceUrl,
      bankSlipUrl: asaasPayment.bankSlipUrl,
    });
  } catch (error) {
    if (error.name === "AsaasError") return res.status(502).json({ error: error.message });
    console.error("[Billing] Erro ao buscar fatura:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
