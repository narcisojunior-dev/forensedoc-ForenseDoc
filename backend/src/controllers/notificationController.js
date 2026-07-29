import { prisma } from "../utils/prisma.js";
import { parsePagination } from "../utils/pagination.js";

/**
 * Notificações visíveis ao usuário: as endereçadas a ele (userId) e as do
 * tenant inteiro (userId = null). Nunca as de outro membro.
 */
function visibilityFilter(req) {
  return {
    tenantId: req.tenantId,
    OR: [{ userId: req.auth.userId }, { userId: null }],
  };
}

export async function listNotifications(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query, { def: 20, max: 50 });
    const where = visibilityFilter(req);

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        // Não lidas primeiro, depois as mais recentes.
        orderBy: [{ read: "asc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, read: false } }),
    ]);

    return res.json({
      notifications,
      unreadCount,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[NotificationController] Erro ao listar notificações:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const unreadCount = await prisma.notification.count({
      where: { ...visibilityFilter(req), read: false },
    });
    return res.json({ unreadCount });
  } catch (error) {
    console.error("[NotificationController] Erro ao contar não lidas:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function markAsRead(req, res) {
  try {
    // updateMany (e não update) para que o filtro de tenant faça parte do
    // WHERE: um id de outro tenant simplesmente não casa, sem vazar 404/200.
    const { count } = await prisma.notification.updateMany({
      where: { ...visibilityFilter(req), id: req.params.id, read: false },
      data: { read: true, readAt: new Date() },
    });

    if (count === 0) {
      const exists = await prisma.notification.count({
        where: { ...visibilityFilter(req), id: req.params.id },
      });
      if (!exists) return res.status(404).json({ error: "Notificação não encontrada." });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[NotificationController] Erro ao marcar como lida:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function markAllAsRead(req, res) {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { ...visibilityFilter(req), read: false },
      data: { read: true, readAt: new Date() },
    });
    return res.json({ success: true, updated: count });
  } catch (error) {
    console.error("[NotificationController] Erro ao marcar todas como lidas:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
