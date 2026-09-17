import { prisma } from "../utils/prisma.js";
import { getBalancePublic } from "../services/creditService.js";
import { parsePagination } from "../utils/pagination.js";
import { temCreditoIlimitado } from "../utils/creditPolicy.js";

export async function getBalance(req, res) {
  try {
    const tenantId = req.tenantId;
    const balance = await getBalancePublic(tenantId);
    // O saldo real do escritório continua sendo informado; `unlimited` diz à
    // tela que, para este usuário, ele não limita nada.
    return res.json({ balance: { ...balance, unlimited: temCreditoIlimitado(req.auth) } });
  } catch (error) {
    console.error("[CreditController] Erro ao buscar saldo:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getTransactions(req, res) {
  try {
    const tenantId = req.tenantId;
    const { page, limit, skip } = parsePagination(req.query);

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
