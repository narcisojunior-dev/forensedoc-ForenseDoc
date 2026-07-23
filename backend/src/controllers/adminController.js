import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { addManualCredits, invalidateCreditCache } from "../services/creditService.js";
import { notify } from "../services/notificationService.js";

/**
 * Admin Panel — fatia mínima necessária para operar o lançamento com
 * fundadores (Módulo 6, M6.1 parcial): gerar convites, conceder crédito
 * manual e suspender/reativar contas.
 *
 * Toda rota aqui já passou por requireAuth + requirePlatformAdmin.
 */

// Toda ação de admin é registrada com o operador que a executou.
async function auditAdminAction(req, action, tenantId, metadata = {}) {
  await prisma.auditLog
    .create({
      data: {
        tenantId,
        userId: req.auth.userId,
        action,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata,
      },
    })
    .catch((err) => {
      console.error(`[Admin] Falha ao registrar audit log '${action}':`, err.message);
    });
}

// ─────────────────────────────────────────────────────────────
// Convites de Fundador
// ─────────────────────────────────────────────────────────────

const founderInviteSchema = z.object({
  email: z.string().email("E-mail inválido").optional(),
  quantity: z.number().int().min(1).max(25).optional().default(1),
});

/** Código curto, legível e sem caracteres ambíguos (0/O, 1/I/l). */
function generateInviteCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `FND-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export async function createFounderInvites(req, res) {
  try {
    const { email, quantity } = founderInviteSchema.parse(req.body || {});

    const plan = await prisma.plan.findFirst({ where: { isFounder: true } });
    if (!plan) {
      return res.status(404).json({ error: "Plano fundador não encontrado. Rode o seed de planos." });
    }

    // Não deixa emitir mais convites do que vagas restantes — cada convite
    // aceito decrementa founderSlotsRemaining no fluxo de billing.
    const pendingInvites = await prisma.founderInvite.count({ where: { usedAt: null } });
    const available = (plan.founderSlotsRemaining ?? 0) - pendingInvites;
    if (quantity > available) {
      return res.status(409).json({
        error: `Vagas insuficientes: ${plan.founderSlotsRemaining} restantes, ${pendingInvites} convite(s) pendente(s).`,
        code: "FOUNDER_SLOTS_EXHAUSTED",
        available: Math.max(available, 0),
      });
    }

    const invites = [];
    for (let i = 0; i < quantity; i++) {
      const invite = await prisma.founderInvite.create({
        data: { code: generateInviteCode(), email: quantity === 1 ? email || null : null },
      });
      invites.push({ code: invite.code, email: invite.email, createdAt: invite.createdAt });
    }

    await auditAdminAction(req, "admin_founder_invites_created", null, {
      quantity,
      codes: invites.map((i) => i.code),
    });

    return res.status(201).json({ invites, slotsRemaining: plan.founderSlotsRemaining });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("[Admin] Erro ao criar convites de fundador:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function listFounderInvites(req, res) {
  try {
    const [invites, plan] = await Promise.all([
      prisma.founderInvite.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.plan.findFirst({ where: { isFounder: true } }),
    ]);

    // O tenant que usou o convite não tem relação declarada no schema —
    // buscamos os nomes em lote para exibir quem resgatou cada código.
    const usedTenantIds = invites.map((i) => i.tenantId).filter(Boolean);
    const tenants = usedTenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: usedTenantIds } },
          select: { id: true, name: true },
        })
      : [];
    const tenantsById = Object.fromEntries(tenants.map((t) => [t.id, t.name]));

    return res.json({
      invites: invites.map((i) => ({
        code: i.code,
        email: i.email,
        usedAt: i.usedAt,
        usedBy: i.tenantId ? tenantsById[i.tenantId] || i.tenantId : null,
        createdAt: i.createdAt,
      })),
      slots: {
        total: plan?.founderSlotsTotal ?? 0,
        remaining: plan?.founderSlotsRemaining ?? 0,
        pending: invites.filter((i) => !i.usedAt).length,
      },
    });
  } catch (error) {
    console.error("[Admin] Erro ao listar convites de fundador:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// ─────────────────────────────────────────────────────────────
// Tenants
// ─────────────────────────────────────────────────────────────

export async function listTenants(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const status = req.query.status;

    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { cpfCnpj: { contains: search } },
              { users: { some: { email: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          cpfCnpj: true,
          status: true,
          createdAt: true,
          creditBalance: true,
          subscription: { select: { status: true, plan: { select: { name: true } } } },
          users: { select: { id: true, name: true, email: true, role: true } },
          _count: { select: { analyses: true } },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    return res.json({
      tenants,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[Admin] Erro ao listar tenants:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getTenant(req, res) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        cpfCnpj: true,
        oabNumber: true,
        oabState: true,
        status: true,
        referralCode: true,
        createdAt: true,
        creditBalance: true,
        subscription: { include: { plan: true } },
        users: {
          select: { id: true, name: true, email: true, role: true, emailVerified: true, lastLoginAt: true },
        },
        payments: { orderBy: { createdAt: "desc" }, take: 10 },
        creditTx: { orderBy: { createdAt: "desc" }, take: 20 },
        _count: { select: { analyses: true } },
      },
    });

    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado." });
    return res.json({ tenant });
  } catch (error) {
    console.error("[Admin] Erro ao buscar tenant:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// ─────────────────────────────────────────────────────────────
// Crédito manual
// ─────────────────────────────────────────────────────────────

const manualCreditSchema = z.object({
  // O `error` cobre o campo ausente/tipo errado; o `.min()` cobre o valor
  // curto. Sem os dois, um campo faltando devolveria a mensagem crua do Zod.
  amount: z
    .number({ error: "Informe a quantidade de créditos." })
    .int("A quantidade deve ser um número inteiro.")
    .refine((n) => n !== 0, "Quantidade não pode ser zero"),
  notes: z
    .string({ error: "Descreva o motivo da concessão." })
    .min(3, "Descreva o motivo da concessão.")
    .max(500, "Motivo muito longo (máximo 500 caracteres)."),
});

export async function grantManualCredits(req, res) {
  try {
    const { amount, notes } = manualCreditSchema.parse(req.body || {});
    const tenantId = req.params.id;

    const balance = await prisma.creditBalance.findUnique({ where: { tenantId } });
    if (!balance) return res.status(404).json({ error: "Tenant não encontrado." });

    // Valores negativos permitem estornar uma concessão equivocada, mas nunca
    // podem deixar a bolsa manual negativa.
    if (amount < 0 && balance.creditsManual + amount < 0) {
      return res.status(409).json({
        error: `Saldo manual insuficiente para remover ${Math.abs(amount)} crédito(s). Atual: ${balance.creditsManual}.`,
      });
    }

    await addManualCredits(tenantId, amount, notes, req.auth.userId);
    await auditAdminAction(req, "admin_credit_granted", tenantId, { amount, notes });

    if (amount > 0) {
      await notify({
        tenantId,
        type: "CREDITS_GRANTED",
        title: `${amount} laudo(s) adicionado(s) à sua conta`,
        body: notes,
        email: false,
      });
    }

    const updated = await prisma.creditBalance.findUnique({ where: { tenantId } });
    return res.json({ success: true, balance: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("[Admin] Erro ao conceder créditos manuais:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// ─────────────────────────────────────────────────────────────
// Suspender / Reativar
// ─────────────────────────────────────────────────────────────

const suspendSchema = z.object({
  reason: z
    .string({ error: "Informe o motivo da suspensão." })
    .min(3, "Informe o motivo da suspensão.")
    .max(500, "Motivo muito longo (máximo 500 caracteres)."),
});

export async function suspendTenant(req, res) {
  try {
    const { reason } = suspendSchema.parse(req.body || {});
    const tenantId = req.params.id;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado." });
    if (tenant.status === "SUSPENDED") {
      return res.status(409).json({ error: "Tenant já está suspenso." });
    }

    await prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });

    // O status do tenant vive dentro do JWT: sem revogar os refresh tokens, a
    // sessão em curso continuaria válida até o access token expirar.
    await prisma.refreshToken.updateMany({
      where: { user: { tenantId }, revoked: false },
      data: { revoked: true },
    });

    await auditAdminAction(req, "admin_tenant_suspended", tenantId, { reason });

    await notify({
      tenantId,
      type: "ACCOUNT_SUSPENDED",
      title: "Conta suspensa",
      body: reason,
    });

    return res.json({ success: true, status: "SUSPENDED" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("[Admin] Erro ao suspender tenant:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function activateTenant(req, res) {
  try {
    const tenantId = req.params.id;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado." });

    // Volta para ACTIVE se houver assinatura, senão para TRIAL — evita
    // marcar como ativo um tenant que nunca assinou nada.
    const newStatus = tenant.subscription ? "ACTIVE" : "TRIAL";
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: newStatus } });

    await auditAdminAction(req, "admin_tenant_activated", tenantId, { newStatus });
    await invalidateCreditCache(tenantId);

    return res.json({ success: true, status: newStatus });
  } catch (error) {
    console.error("[Admin] Erro ao reativar tenant:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
