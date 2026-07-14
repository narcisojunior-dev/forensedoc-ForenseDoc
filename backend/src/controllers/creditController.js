import { prisma } from "../utils/prisma.js";
import { getBalancePublic } from "../services/creditService.js";

export async function getBalance(req, res) {
  try {
    const tenantId = req.tenantId;
    const balance = await getBalancePublic(tenantId);
    return res.json({ balance });
  } catch (error) {
    console.error("[CreditController] Erro ao buscar saldo:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getTransactions(req, res) {
  try {
    const tenantId = req.tenantId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: { select: { name: true, email: true } },
        }
      }),
      prisma.creditTransaction.count({ where: { tenantId } })
    ]);

    return res.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    console.error("[CreditController] Erro ao buscar transações:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
