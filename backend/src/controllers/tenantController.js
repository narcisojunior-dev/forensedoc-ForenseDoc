import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma.js";
import { enqueueEmail } from "../services/notificationService.js";

const inviteSchema = z.object({
  email: z.string().email(),
});

const acceptInviteSchema = z.object({
  name: z.string().min(3, "Nome muito curto"),
  password: z.string().min(8, "Senha deve ter no mínimo 8 caracteres"),
});

const INVITE_EXPIRES_MS = 72 * 60 * 60 * 1000; // 72h

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Quantos usuários o plano do tenant permite. Sem assinatura (TRIAL), só o
 * titular — o cliente compra o direito de usar créditos, e o tamanho da
 * equipe é parte do que ele contrata.
 */
export async function getMaxUsers(tenantId, client = prisma) {
  const subscription = await client.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!subscription || subscription.status === "CANCELLED") return 1;
  return subscription.plan.maxUsers;
}

/**
 * Vagas ocupadas: usuários ativos + convites pendentes ainda válidos.
 *
 * Contar os convites pendentes é o que impede o titular de disparar 10
 * convites num plano de 3 — cada um passava porque, até alguém aceitar, o
 * número de usuários não mudava.
 */
export async function countOccupiedSeats(tenantId, client = prisma) {
  const [users, pendingInvites] = await Promise.all([
    client.user.count({ where: { tenantId, active: true } }),
    client.tenantInvite.count({
      where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  return { users, pendingInvites, total: users + pendingInvites };
}

export async function inviteMember(req, res) {
  try {
    const { email } = inviteSchema.parse(req.body);
    const tenantId = req.tenantId; // Injetado pelo requireAuth

    // Verificar se usuário logado é OWNER
    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode convidar membros." });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    // Verifica se já existe uma conta com esse e-mail
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }

    // Reenviar convite para quem já tem um pendente apenas renova o token —
    // a vaga dele já está contabilizada, então não consome outra.
    const pendingInvite = await prisma.tenantInvite.findFirst({
      where: { tenantId, email, acceptedAt: null },
    });

    // Limite do plano: usuários + convites pendentes.
    if (!pendingInvite) {
      const [maxUsers, seats] = await Promise.all([
        getMaxUsers(tenantId),
        countOccupiedSeats(tenantId),
      ]);

      if (seats.total >= maxUsers) {
        return res.status(403).json({
          error:
            seats.pendingInvites > 0
              ? `Limite do plano atingido (${maxUsers} usuário(s)): ${seats.users} na equipe e ${seats.pendingInvites} convite(s) aguardando aceite.`
              : `Limite do plano atingido (${maxUsers} usuário(s)). Faça upgrade para convidar mais membros.`,
          code: "PLAN_USER_LIMIT_REACHED",
          limit: maxUsers,
          ...seats,
        });
      }
    }

    const inviteToken = uuidv4();
    const tokenHash = hashToken(inviteToken);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_MS);

    if (pendingInvite) {
      await prisma.tenantInvite.update({
        where: { id: pendingInvite.id },
        data: { tokenHash, expiresAt, invitedById: req.auth.userId },
      });
    } else {
      await prisma.tenantInvite.create({
        data: {
          tenantId,
          email,
          role: "MEMBER",
          tokenHash,
          expiresAt,
          invitedById: req.auth.userId,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: req.auth.userId,
        action: "member_invited",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { email },
      },
    });

    const inviteUrl = `${process.env.FRONTEND_URL}/invite/${inviteToken}`;
    // O JWT não carrega o nome de quem convida — buscamos só esse campo.
    const inviter = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { name: true },
    });
    await enqueueEmail({
      to: email,
      template: "INVITE_RECEIVED",
      data: {
        tenantName: tenant.name,
        inviterName: inviter?.name || tenant.name,
        inviteUrl,
      },
    });

    return res.status(201).json({ message: "Convite enviado com sucesso." });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "E-mail inválido." });
    console.error("[Tenant] Erro ao convidar membro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getInviteInfo(req, res) {
  try {
    const { token } = req.params;
    const invite = await prisma.tenantInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        tenant: { select: { name: true } },
        // Quem convidou aparece na tela de aceite pelo mesmo motivo que aparece
        // no e-mail: o convidado precisa reconhecer de quem veio antes de criar
        // uma senha.
        invitedBy: { select: { name: true } },
      },
    });

    // Os `code` acompanham cada recusa para a tela distinguir os casos sem
    // depender do texto da mensagem.
    if (!invite) {
      return res.status(404).json({ error: "Convite não encontrado.", code: "INVITE_NOT_FOUND" });
    }
    if (invite.acceptedAt) {
      return res.status(400).json({ error: "Convite já foi aceito.", code: "INVITE_ALREADY_ACCEPTED" });
    }
    if (new Date() > invite.expiresAt) {
      return res.status(400).json({ error: "Convite expirado.", code: "INVITE_EXPIRED" });
    }

    return res.json({
      email: invite.email,
      role: invite.role,
      tenantName: invite.tenant.name,
      invitedByName: invite.invitedBy?.name || null,
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    console.error("[Tenant] Erro ao buscar convite:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function acceptInvite(req, res) {
  try {
    const { token } = req.params;
    const { name, password } = acceptInviteSchema.parse(req.body);

    const invite = await prisma.tenantInvite.findUnique({ where: { tokenHash: hashToken(token) } });

    if (!invite) {
      return res.status(404).json({ error: "Convite não encontrado.", code: "INVITE_NOT_FOUND" });
    }
    if (invite.acceptedAt) {
      return res.status(400).json({ error: "Convite já foi aceito.", code: "INVITE_ALREADY_ACCEPTED" });
    }
    if (new Date() > invite.expiresAt) {
      return res.status(400).json({ error: "Convite expirado.", code: "INVITE_EXPIRED" });
    }

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return res.status(400).json({ error: "E-mail já cadastrado.", code: "EMAIL_ALREADY_REGISTERED" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // O limite é revalidado AQUI, no aceite — não basta checar no envio.
    // Entre convidar e aceitar, o plano pode ter mudado, outros convites
    // podem ter sido resgatados ou o titular pode ter feito downgrade.
    // Serializable impede que dois aceites simultâneos passem pela mesma
    // vaga: um dos dois falha e é retentado pelo cliente.
    try {
      await prisma.$transaction(
        async (tx) => {
          const maxUsers = await getMaxUsers(invite.tenantId, tx);
          const users = await tx.user.count({
            where: { tenantId: invite.tenantId, active: true },
          });

          if (users >= maxUsers) {
            throw new Error("PLAN_USER_LIMIT_REACHED");
          }

          await tx.user.create({
            data: {
              tenantId: invite.tenantId,
              email: invite.email,
              name,
              passwordHash,
              role: invite.role,
              emailVerified: true, // o convite já comprova posse do e-mail
            },
          });

          await tx.tenantInvite.update({
            where: { id: invite.id },
            data: { acceptedAt: new Date() },
          });
        },
        { isolationLevel: "Serializable" }
      );
    } catch (err) {
      if (err.message === "PLAN_USER_LIMIT_REACHED") {
        return res.status(403).json({
          error:
            "O escritório atingiu o limite de usuários do plano. Peça ao titular para liberar uma vaga ou fazer upgrade.",
          code: "PLAN_USER_LIMIT_REACHED",
        });
      }
      throw err;
    }

    return res.status(201).json({ message: "Convite aceito. Você já pode fazer login." });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0].message });
    console.error("[Tenant] Erro ao aceitar convite:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function removeMember(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode remover membros." });
    }

    if (id === req.auth.userId) {
      return res.status(403).json({ error: "Você não pode remover a si mesmo." });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.tenantId !== tenantId) {
      return res.status(404).json({ error: "Membro não encontrado." });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { active: false } }),
      prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } }),
      prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.auth.userId,
          action: "member_removed",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { removedUserId: id },
        },
      }),
    ]);

    return res.json({ message: "Membro removido com sucesso." });
  } catch (error) {
    console.error("[Tenant] Erro ao remover membro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getMembers(req, res) {
  try {
    const tenantId = req.tenantId;

    // Convites pendentes vão junto porque ocupam vaga do plano
    // (`countOccupiedSeats`): sem vê-los, o titular não entende por que atingiu
    // o limite com menos membros do que o plano permite.
    const [users, pendingInvites, maxUsers] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId },
        select: { id: true, name: true, email: true, role: true, lastLoginAt: true, active: true },
      }),
      prisma.tenantInvite.findMany({
        where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      getMaxUsers(tenantId),
    ]);

    const activeUsers = users.filter((u) => u.active);

    return res.json({
      members: users,
      pendingInvites,
      seats: {
        maxUsers,
        users: activeUsers.length,
        pendingInvites: pendingInvites.length,
        total: activeUsers.length + pendingInvites.length,
      },
    });
  } catch (error) {
    console.error("[Tenant] Erro ao listar membros:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/**
 * Revoga um convite pendente, liberando a vaga que ele ocupava.
 *
 * Sem isto, um convite enviado por engano trava um assento do plano por 72h —
 * e num plano de 3 usuários isso é um terço da capacidade parada.
 */
export async function revokeInvite(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode revogar convites." });
    }

    const invite = await prisma.tenantInvite.findUnique({ where: { id } });
    // A checagem de tenant é o que impede revogar convite de outro escritório
    // com um id adivinhado.
    if (!invite || invite.tenantId !== tenantId) {
      return res.status(404).json({ error: "Convite não encontrado.", code: "INVITE_NOT_FOUND" });
    }
    if (invite.acceptedAt) {
      return res.status(400).json({
        error: "Este convite já foi aceito. Remova o membro pela lista de equipe.",
        code: "INVITE_ALREADY_ACCEPTED",
      });
    }

    await prisma.$transaction([
      prisma.tenantInvite.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.auth.userId,
          action: "member_invite_revoked",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { email: invite.email },
        },
      }),
    ]);

    return res.json({ message: "Convite revogado." });
  } catch (error) {
    console.error("[Tenant] Erro ao revogar convite:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
