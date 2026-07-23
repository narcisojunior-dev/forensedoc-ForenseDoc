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

export async function inviteMember(req, res) {
  try {
    const { email } = inviteSchema.parse(req.body);
    const tenantId = req.tenantId; // Injetado pelo requireAuth

    // Verificar se usuário logado é OWNER
    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode convidar membros." });
    }

    // Verificar limite de usuários do plano
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: true,
        subscription: { include: { plan: true } },
      },
    });

    // Se estiver em TRIAL (sem assinatura ativa), o limite padrão é 1 (apenas o owner)
    const maxUsers = tenant.subscription ? tenant.subscription.plan.maxUsers : 1;
    if (tenant.users.length >= maxUsers) {
      return res.status(403).json({ error: "Limite de membros do plano atingido." });
    }

    // Verifica se já existe uma conta com esse e-mail
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }

    const inviteToken = uuidv4();
    const tokenHash = hashToken(inviteToken);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_MS);

    // Se já existir um convite pendente para esse e-mail neste tenant, renova o token
    // em vez de criar um duplicado.
    const pendingInvite = await prisma.tenantInvite.findFirst({
      where: { tenantId, email, acceptedAt: null },
    });

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
    // O JWT não carrega o nome — aproveitamos os users já incluídos no tenant.
    const inviter = tenant.users.find((u) => u.id === req.auth.userId);
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
      include: { tenant: { select: { name: true } } },
    });

    if (!invite) return res.status(404).json({ error: "Convite não encontrado." });
    if (invite.acceptedAt) return res.status(400).json({ error: "Convite já foi aceito." });
    if (new Date() > invite.expiresAt) return res.status(400).json({ error: "Convite expirado." });

    return res.json({
      email: invite.email,
      role: invite.role,
      tenantName: invite.tenant.name,
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

    if (!invite) return res.status(404).json({ error: "Convite não encontrado." });
    if (invite.acceptedAt) return res.status(400).json({ error: "Convite já foi aceito." });
    if (new Date() > invite.expiresAt) return res.status(400).json({ error: "Convite expirado." });

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) return res.status(400).json({ error: "E-mail já cadastrado." });

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.$transaction([
      prisma.user.create({
        data: {
          tenantId: invite.tenantId,
          email: invite.email,
          name,
          passwordHash,
          role: invite.role,
          emailVerified: true, // o convite já comprova posse do e-mail
        },
      }),
      prisma.tenantInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return res.status(201).json({ message: "Convite aceito. Você já pode fazer login." });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
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
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastLoginAt: true,
      },
    });

    return res.json({ members: users });
  } catch (error) {
    console.error("[Tenant] Erro ao listar membros:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
