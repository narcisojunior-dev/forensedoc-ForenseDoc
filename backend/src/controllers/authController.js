import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";
import { enqueueEmail } from "../services/notificationService.js";
import { redis } from "../utils/redis.js";

// ─── Schemas de Validação (Zod) ────────────────────────────────────────────────
const registerSchema = z.object({
  name: z.string().min(3, "Nome muito curto"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "Senha deve ter no mínimo 8 caracteres"),
  cpfCnpj: z.string().min(11, "CPF/CNPJ inválido"),
  oabNumber: z.string().optional(),
  oabState: z.string().length(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("E-mail inválido"),
});

const updateProfileSchema = z.object({
  name: z.string().min(3, "Nome muito curto").optional(),
  oabNumber: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Senha atual é obrigatória"),
  newPassword: z.string().min(8, "Senha deve ter no mínimo 8 caracteres"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token ausente"),
  newPassword: z.string().min(8, "Senha deve ter no mínimo 8 caracteres"),
});

// Helper para gerar hash do token de refresh e verificação
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Controllers ────────────────────────────────────────────────────────────────

export async function register(req, res) {
  try {
    const data = registerSchema.parse(req.body);

    // 1. Verificar unicidade (E-mail e CPF/CNPJ)
    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) return res.status(400).json({ error: "E-mail já cadastrado." });

    const existingTenant = await prisma.tenant.findUnique({ where: { cpfCnpj: data.cpfCnpj } });
    if (existingTenant) return res.status(400).json({ error: "CPF/CNPJ já cadastrado." });

    // 2. Hash da senha
    const passwordHash = await bcrypt.hash(data.password, 12);

    // 3. Transação: Criar Tenant, User, Saldo de Créditos
    const result = await prisma.$transaction(async (tx) => {
      // Criar Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: data.name, // Nome provisório do escritório
          cpfCnpj: data.cpfCnpj,
          oabNumber: data.oabNumber,
          oabState: data.oabState,
          status: "TRIAL",
        },
      });

      // Criar User (Owner)
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: data.name,
          email: data.email,
          passwordHash,
          role: "OWNER",
          oabNumber: data.oabNumber,
          isPlatformAdmin: data.email === process.env.PLATFORM_ADMIN_EMAIL,
        },
      });

      // Criar Saldo Trial (3 créditos)
      await tx.creditBalance.create({
        data: {
          tenantId: tenant.id,
          creditsMonthly: 0,
          creditsAvulso: 3, // 3 laudos grátis
        },
      });

      // Criar transação de crédito inicial
      await tx.creditTransaction.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          type: "EARN_AVULSO",
          amount: 3,
          creditType: "avulso",
          source: "trial",
          notes: "Bônus de cadastro",
        },
      });

      // Criar token de verificação de e-mail
      const verifyToken = uuidv4();
      await tx.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(verifyToken),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        },
      });

      return { user, tenant, verifyToken };
    });

    // 4. Enfileirar o e-mail de verificação. A conta já está criada, então o
    // envio não pode prender a resposta nem falhar o cadastro — a fila cuida
    // do retry se o SMTP estiver instável.
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${result.verifyToken}`;
    await enqueueEmail({
      to: result.user.email,
      template: "EMAIL_VERIFICATION",
      data: { name: result.user.name, verifyUrl },
    });

    return res.status(201).json({
      message: "Cadastro realizado. Verifique seu e-mail para ativar a conta.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error("[Auth] Erro no registro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) return res.status(401).json({ error: "Credenciais inválidas." });

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) return res.status(401).json({ error: "Credenciais inválidas." });

    if (!user.emailVerified) return res.status(403).json({ error: "E-mail não confirmado.", code: "EMAIL_NOT_VERIFIED" });
    if (!user.active) return res.status(403).json({ error: "Conta desativada.", code: "ACCOUNT_DEACTIVATED" });
    if (user.tenant.status === "SUSPENDED") return res.status(403).json({ error: "Conta suspensa.", code: "ACCOUNT_SUSPENDED" });

    // Gerar Tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin,
      status: user.tenant.status,
    });

    const refreshTokenString = uuidv4();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshTokenString),
        expiresAt: refreshExpiresAt,
      },
    });

    // Atualizar último login e logar auditoria
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: "login",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });

    // Enviar refreshToken via Cookie HttpOnly
    res.cookie("refreshToken", refreshTokenString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Dados inválidos." });
    console.error("[Auth] Erro no login:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function refresh(req, res) {
  try {
    // Para simplificar no dev local se cookies não estiverem configurados, podemos aceitar no header/body também,
    // mas em prod sempre usar cookie
    const refreshTokenString = req.cookies?.refreshToken || req.body.refreshToken;
    if (!refreshTokenString) return res.status(401).json({ error: "Refresh token ausente." });

    const hashedToken = hashToken(refreshTokenString);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      include: { user: { include: { tenant: true } } },
    });

    if (!storedToken) return res.status(401).json({ error: "Refresh token inválido." });

    if (storedToken.revoked) {
      // Rotacionamento comprometido: revogar todos os tokens do usuário
      await prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId },
        data: { revoked: true },
      });
      return res.status(401).json({ error: "Token comprometido. Faça login novamente." });
    }

    if (new Date() > storedToken.expiresAt) {
      return res.status(401).json({ error: "Refresh token expirado." });
    }

    // Revogar token atual
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Gerar novos tokens
    const { user } = storedToken;
    const newAccessToken = generateAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin,
      status: user.tenant.status,
    });

    const newRefreshTokenString = uuidv4();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(newRefreshTokenString),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    res.cookie("refreshToken", newRefreshTokenString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken: newAccessToken });
  } catch (error) {
    console.error("[Auth] Erro no refresh:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function verifyEmail(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token ausente." });

    const hashedToken = hashToken(token);
    const verification = await prisma.emailVerification.findUnique({
      where: { tokenHash: hashedToken },
    });

    if (!verification) return res.status(400).json({ error: "Token inválido." });
    if (verification.usedAt) return res.status(400).json({ error: "E-mail já verificado." });
    if (new Date() > verification.expiresAt) return res.status(400).json({ error: "Token expirado." });

    await prisma.$transaction([
      prisma.emailVerification.update({
        where: { id: verification.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerified: true },
      }),
    ]);

    return res.json({ message: "E-mail verificado com sucesso." });
  } catch (error) {
    console.error("[Auth] Erro na verificação:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });

    // Sempre responde com a mesma mensagem genérica, exista ou não o e-mail
    // (evita enumeração de contas cadastradas).
    if (user) {
      const resetToken = uuidv4();
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(resetToken),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
        },
      });

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
      await enqueueEmail({
        to: user.email,
        template: "PASSWORD_RESET",
        data: { name: user.name, resetUrl },
      });
    }

    return res.json({ message: "Se o e-mail estiver cadastrado, você receberá instruções para redefinir sua senha." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error("[Auth] Erro no forgot-password:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    const hashedToken = hashToken(token);
    const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashedToken } });

    if (!reset) return res.status(400).json({ error: "Token inválido." });
    if (reset.used) return res.status(400).json({ error: "Token já utilizado." });
    if (new Date() > reset.expiresAt) return res.status(400).json({ error: "Token expirado." });

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } }),
      // Revoga todos os refresh tokens do usuário — força novo login em todos os dispositivos
      prisma.refreshToken.updateMany({ where: { userId: reset.userId }, data: { revoked: true } }),
      prisma.auditLog.create({
        data: {
          userId: reset.userId,
          action: "password_reset",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      }),
    ]);

    return res.json({ message: "Senha redefinida com sucesso." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error("[Auth] Erro no reset-password:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function logout(req, res) {
  try {
    const refreshTokenString = req.cookies?.refreshToken || req.body.refreshToken;
    const accessToken = req.headers.authorization?.split(" ")[1];

    if (refreshTokenString) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshTokenString) },
        data: { revoked: true },
      });
    }

    if (accessToken) {
      // Redis blacklist até o token expirar (15 min)
      await redis.setex(`blacklist:${accessToken}`, 15 * 60, "1");
    }

    res.clearCookie("refreshToken");
    return res.json({ message: "Logout realizado com sucesso." });
  } catch (error) {
    console.error("[Auth] Erro no logout:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function me(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        oabNumber: true,
        isPlatformAdmin: true,
        tenant: {
          select: {
            id: true,
            name: true,
            status: true,
          }
        }
      }
    });

    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    return res.json({ user });
  } catch (error) {
    console.error("[Auth] Erro em /me:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function updateProfile(req, res) {
  try {
    const data = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.auth.userId },
      data,
      select: { id: true, name: true, email: true, oabNumber: true, role: true },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        action: "profile_updated",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });

    return res.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error("[Auth] Erro ao atualizar perfil:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) return res.status(401).json({ error: "Senha atual incorreta." });

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Revoga todos os refresh tokens — força novo login em todos os dispositivos,
      // mesmo padrão de segurança já usado em resetPassword.
      prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } }),
      prisma.auditLog.create({
        data: {
          tenantId: req.auth.tenantId,
          userId: user.id,
          action: "password_changed",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      }),
    ]);

    return res.json({ message: "Senha alterada com sucesso." });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error("[Auth] Erro ao trocar senha:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
