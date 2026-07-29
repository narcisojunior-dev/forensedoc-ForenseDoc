import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { countOccupiedSeats } from "./tenantController.js";
import { parsePagination } from "../utils/pagination.js";

/**
 * Métricas e gestão de planos do Admin Panel (Módulo 6 — RF-18/RF-20).
 * Todas as rotas já passaram por requireAuth + requirePlatformAdmin.
 */

const BREAK_EVEN_MRR = 2500; // meta do PRD

// Valor mensal normalizado de uma assinatura. Anual = 10× a mensalidade
// (regra do PRD), diluído em 12 meses — mesma conta do asaasService.
function monthlyValue(sub) {
  const price = Number(sub.plan.priceBrl);
  return sub.isAnnual ? (price * 10) / 12 : price;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function getDashboard(_req, res) {
  try {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [activeSubs, tenantsByPlanRaw, analysesTotal, analysesThisMonth, recentSignups] =
      await Promise.all([
        prisma.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
        prisma.subscription.groupBy({
          by: ["planId"],
          where: { status: "ACTIVE" },
          _count: true,
        }),
        prisma.analysis.count({ where: { status: { in: ["COMPLETED", "REFUNDED", "ERROR"] } } }),
        prisma.analysis.count({ where: { createdAt: { gte: monthStart } } }),
        prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      ]);

    const mrr = activeSubs.reduce((sum, s) => sum + monthlyValue(s), 0);

    // Nomes dos planos para o breakdown.
    const planIds = tenantsByPlanRaw.map((r) => r.planId);
    const plans = planIds.length
      ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } })
      : [];
    const planName = Object.fromEntries(plans.map((p) => [p.id, p.name]));
    const tenantsByPlan = tenantsByPlanRaw.map((r) => ({
      plan: planName[r.planId] || r.planId,
      count: r._count,
    }));

    // Churn do mês corrente: canceladas no mês ÷ ativas no início do mês.
    const [cancelledThisMonth, activeAtMonthStart] = await Promise.all([
      prisma.subscription.count({
        where: { status: "CANCELLED", updatedAt: { gte: monthStart } },
      }),
      // Aproximação: ativas hoje + as canceladas no mês (que estavam ativas no início).
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
    ]);
    const churnBase = activeAtMonthStart + cancelledThisMonth;
    const churnPct = churnBase > 0 ? (cancelledThisMonth / churnBase) * 100 : 0;

    // Série dos últimos 12 meses: cadastros e laudos por mês.
    const monthly = await buildMonthlySeries(now);

    return res.json({
      mrr: Number(mrr.toFixed(2)),
      arr: Number((mrr * 12).toFixed(2)),
      breakEven: {
        target: BREAK_EVEN_MRR,
        achieved: mrr >= BREAK_EVEN_MRR,
        pct: Number(((mrr / BREAK_EVEN_MRR) * 100).toFixed(1)),
      },
      activeSubscribers: activeSubs.length,
      tenantsByPlan,
      churn: { count: cancelledThisMonth, pct: Number(churnPct.toFixed(1)) },
      analyses: { total: analysesTotal, thisMonth: analysesThisMonth },
      recentSignups,
      monthly,
    });
  } catch (error) {
    console.error("[AdminMetrics] Erro ao montar dashboard:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// Cadastros e laudos por mês nos últimos 12 meses, para os gráficos.
async function buildMonthlySeries(now) {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ label: start.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }), start, end });
  }

  return Promise.all(
    months.map(async ({ label, start, end }) => {
      const [signups, analyses] = await Promise.all([
        prisma.tenant.count({ where: { createdAt: { gte: start, lt: end } } }),
        prisma.analysis.count({ where: { createdAt: { gte: start, lt: end } } }),
      ]);
      return { month: label, signups, analyses };
    })
  );
}

// ─────────────────────────────────────────────────────────────
// Gestão de planos (RF-20)
// ─────────────────────────────────────────────────────────────

export async function listPlans(_req, res) {
  try {
    const plans = await prisma.plan.findMany({ orderBy: { priceBrl: "asc" } });
    // Quantos tenants em cada plano — informa o impacto de uma edição.
    const counts = await prisma.subscription.groupBy({
      by: ["planId"],
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      _count: true,
    });
    const byPlan = Object.fromEntries(counts.map((c) => [c.planId, c._count]));
    return res.json({
      plans: plans.map((p) => ({ ...p, activeSubscriptions: byPlan[p.id] || 0 })),
    });
  } catch (error) {
    console.error("[AdminMetrics] Erro ao listar planos:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

const updatePlanSchema = z
  .object({
    priceBrl: z.number({ error: "Preço inválido." }).nonnegative("Preço não pode ser negativo.").optional(),
    creditsMonthly: z.number({ error: "Créditos inválidos." }).int().nonnegative().optional(),
    maxUsers: z.number({ error: "Limite de usuários inválido." }).int().min(1, "O plano deve permitir ao menos 1 usuário.").optional(),
    // Preço do avulso para quem já assina o plano. null desliga o desconto:
    // o assinante volta a pagar o preço cheio.
    avulsoPriceBrl: z.number({ error: "Preço do avulso inválido." }).nonnegative("Preço do avulso não pode ser negativo.").nullable().optional(),
    // Quantos avulsos com desconto por ciclo. 0 desliga o benefício mantendo o
    // preço cadastrado para quando o limite voltar a subir.
    avulsoDiscountLimit: z.number({ error: "Limite de avulsos inválido." }).int().nonnegative("O limite não pode ser negativo.").optional(),
    isActive: z.boolean().optional(),
    founderSlotsRemaining: z.number().int().nonnegative().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Nenhum campo para atualizar.");

export async function updatePlan(req, res) {
  try {
    const data = updatePlanSchema.parse(req.body || {});
    const planId = req.params.id;

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: "Plano não encontrado." });

    // Reduzir maxUsers não pode deixar nenhum escritório do plano acima do
    // limite — mesma regra que bloqueia o downgrade individual.
    if (data.maxUsers != null && data.maxUsers < plan.maxUsers) {
      const subs = await prisma.subscription.findMany({
        where: { planId, status: { in: ["ACTIVE", "OVERDUE"] } },
        select: { tenantId: true },
      });
      for (const sub of subs) {
        const seats = await countOccupiedSeats(sub.tenantId);
        if (seats.total > data.maxUsers) {
          return res.status(409).json({
            error: `Não é possível reduzir para ${data.maxUsers} usuário(s): há escritório(s) neste plano com mais membros. Ajuste as equipes antes.`,
            code: "PLAN_DOWNGRADE_BLOCKED",
          });
        }
      }
    }

    const updated = await prisma.plan.update({ where: { id: planId }, data });

    await prisma.auditLog
      .create({
        data: {
          userId: req.auth.userId,
          action: "admin_plan_updated",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { planId, changes: data },
        },
      })
      .catch((err) => console.error("[AdminMetrics] Falha ao auditar edição de plano:", err.message));

    return res.json({ plan: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("[AdminMetrics] Erro ao atualizar plano:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// ─────────────────────────────────────────────────────────────
// Audit log (RF-19 apoio)
// ─────────────────────────────────────────────────────────────

/**
 * Filtros do audit log, coagidos a string/data antes de entrar no `where`.
 *
 * `?action[not]=login` chega como objeto pelo qs e o Prisma o interpretaria
 * como operador. As datas também passam a ser validadas: `new Date("qualquer
 * coisa")` produzia `Invalid Date` e derrubava a consulta com 500.
 */
const auditLogQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  tenantId: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function listAuditLogs(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { def: 30 });
    const filters = auditLogQuerySchema.parse(req.query);

    const where = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [logs, total, actions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: { select: { name: true, email: true } },
          tenant: { select: { name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
      // Lista distinta de ações para alimentar o filtro do frontend.
      prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    ]);

    return res.json({
      logs,
      actions: actions.map((a) => a.action),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Filtro inválido." });
    }
    console.error("[AdminMetrics] Erro ao listar audit logs:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// ─────────────────────────────────────────────────────────────
// Pagamentos de todos os tenants (RF-18 apoio)
// ─────────────────────────────────────────────────────────────

export async function listAllPayments(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { def: 30 });
    // Mesmo motivo do audit log: sem o enum, `?status[not]=PAID` entraria no
    // where como operador do Prisma.
    const { status } = z
      .object({ status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELLED"]).optional() })
      .parse(req.query);
    const where = status ? { status } : {};

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { tenant: { select: { name: true } } },
      }),
      prisma.payment.count({ where }),
    ]);

    return res.json({
      payments,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Filtro inválido." });
    }
    console.error("[AdminMetrics] Erro ao listar pagamentos:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
