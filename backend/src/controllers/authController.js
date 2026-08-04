import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { generateAccessToken, generateTotpChallenge } from "../utils/jwt.js";
import { totpAtivo } from "../services/totpService.js";
import { enqueueEmail } from "../services/notificationService.js";
import { redis } from "../utils/redis.js";
import { normalizeEmail } from "../utils/stringUtils.js";
import { validatePassword } from "../utils/passwordPolicy.js";
import { TERMS_VERSION, TERMS_LABEL } from "../legal/termsVersion.js";
import {
  applyLoginBackoff,
  registerLoginFailure,
  clearLoginFailures,
} from "../utils/loginBackoff.js";

// ─── Schemas de Validação (Zod) ────────────────────────────────────────────────

// Normaliza ANTES de validar: um endereço colado com espaço à direita ou com
// maiúsculas é o mesmo endereço, e reprová-lo por formato só confunde o usuário.
const emailField = (message = "E-mail inválido") =>
  z.string().transform(normalizeEmail).pipe(z.string().email(message));

const registerSchema = z.object({
  name: z.string().min(3, "Nome muito curto"),
  email: emailField(),
  password: z.string().min(1, "Senha é obrigatória"),
  cpfCnpj: z.string().min(11, "CPF/CNPJ inválido"),
  oabNumber: z.string().optional(),
  oabState: z.string().length(2).optional(),

  /*
   * Aceite dos documentos jurídicos, com a VERSÃO que o usuário viu.
   *
   * Exigir a versão, e não um booleano, é o que torna o aceite demonstrável:
   * documentos mudam, e sem ela qualquer cláusula invocada pode ser respondida
   * com "isso não estava lá quando eu me cadastrei".
   *
   * A validação recusa versão diferente da vigente. Isso cobre o caso do
   * formulário aberto numa aba antiga: se os termos mudaram entre o
   * carregamento da página e o envio, a pessoa aceitou um texto que não é mais
   * o atual, e registrar como se fosse seria falso.
   */
  termsVersion: z.literal(TERMS_VERSION, {
    error: "É necessário aceitar os Termos de Uso e a Política de Privacidade.",
  }),
});

const loginSchema = z.object({
  email: emailField(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: emailField(),
});

const updateProfileSchema = z.object({
  name: z.string().min(3, "Nome muito curto").optional(),
  oabNumber: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Senha atual é obrigatória"),
  newPassword: z.string().min(1, "Senha é obrigatória"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token ausente"),
  newPassword: z.string().min(1, "Senha é obrigatória"),
});

// Helper para gerar hash do token de refresh e verificação
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Resposta do cadastro bem-sucedido. Reutilizada quando o e-mail já existe para
 * que as duas situações fiquem indistinguíveis de fora — quem tenta descobrir
 * se um endereço tem conta aqui recebe sempre o mesmo texto e o mesmo status.
 */
const REGISTER_OK = {
  message: "Cadastro realizado. Verifique seu e-mail para ativar a conta.",
};

/**
 * Hash descartável com o mesmo custo (12 rounds) dos hashes reais.
 *
 * O login precisa gastar o mesmo tempo existindo ou não o usuário: retornar
 * antes do `bcrypt.compare` deixa a diferença mensurável de fora, e ela revela
 * quais e-mails têm conta. Gerado uma vez no boot.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("credenciais-invalidas", 12);

/**
 * Nome do cookie de refresh.
 *
 * "refreshToken" era genérico demais: cookies não são isolados por PORTA, só por
 * host. Qualquer outra aplicação rodando em localhost que use o mesmo nome grava
 * um cookie que o navegador envia junto — e o cookie-parser resolve o conflito
 * pegando a PRIMEIRA ocorrência. Na prática, um projeto vizinho sequestrava a
 * sessão daqui e todo recarregamento de página caía no login.
 *
 * O prefixo do produto elimina a colisão. Em produção, com domínio dedicado, o
 * risco é menor — mas o custo de prefixar é zero.
 */
export const REFRESH_COOKIE = "forensedoc_rt";

/** Atributos do cookie, iguais em toda emissão. */
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Segundos restantes até o access token expirar — o tempo exato que ele precisa
 * ficar na blacklist do logout. Devolve 0 para token ilegível ou já vencido,
 * casos em que a blacklist não teria utilidade nenhuma.
 */
function accessTokenTtlSeconds(token) {
  try {
    const { exp } = jwt.decode(token) || {};
    if (!exp) return 0;
    return Math.max(0, exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

// ─── Controllers ────────────────────────────────────────────────────────────────

export async function register(req, res) {
  try {
    const data = registerSchema.parse(req.body);

    // 1. Verificar unicidade (E-mail e CPF/CNPJ)
    // E-mail duplicado responde como sucesso: dizer "E-mail já cadastrado."
    // transformava esta rota pública num verificador de contas. O dono legítimo
    // do endereço descobre a duplicidade pelo e-mail que recebe; quem está
    // sondando, não. O CPF/CNPJ segue explícito — não é um identificador que se
    // testa em massa e o erro claro evita um suporte desnecessário.
    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      await enqueueEmail({
        to: existingUser.email,
        template: "PASSWORD_RESET_HINT",
        data: { name: existingUser.name, loginUrl: `${process.env.FRONTEND_URL}/login` },
      }).catch(() => {});
      return res.status(201).json(REGISTER_OK);
    }

    const existingTenant = await prisma.tenant.findUnique({ where: { cpfCnpj: data.cpfCnpj } });
    if (existingTenant) return res.status(400).json({ error: "CPF/CNPJ já cadastrado." });

    // Política de senha depois da unicidade: não vale gastar uma chamada ao
    // HIBP por um cadastro que já vai ser recusado.
    const politica = await validatePassword(data.password, { email: data.email, name: data.name });
    if (!politica.ok) return res.status(400).json({ error: politica.error, code: "WEAK_PASSWORD" });

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
          termsVersion: data.termsVersion,
          termsAcceptedAt: new Date(),
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

      /*
       * Registro do aceite na trilha de auditoria.
       *
       * O campo em `User` guarda o ESTADO (qual versão vale agora); o audit log
       * guarda o EVENTO, com data, hora, endereço IP e navegador. É o segundo
       * que sustenta a alegação em juízo, porque demonstra as circunstâncias do
       * aceite, e não apenas o seu resultado.
       *
       * Dentro da transação de propósito: um aceite registrado para um cadastro
       * que não completou seria pior que nenhum registro.
       */
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          action: "terms_accepted",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { version: data.termsVersion, documento: TERMS_LABEL },
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
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("[Auth] Erro no registro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/**
 * Emite o par access + refresh e planta o cookie.
 *
 * Existia em duplicata entre `login` e `refresh`, e o segundo fator seria a
 * terceira cópia. O que precisava deixar de ser copiado é o `mfaVerified`: ele
 * nasce na verificação do TOTP, atravessa a rotação do refresh e alimenta a
 * claim do access token. Espalhado em três lugares, bastaria um esquecer de
 * propagá-lo para o admin ser derrubado do painel a cada 15 minutos, ou, pior,
 * para a marca ser afirmada onde não houve verificação.
 */
export async function emitirSessao(res, user, { mfaVerified = false } = {}) {
  const accessToken = generateAccessToken({
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    isPlatformAdmin: user.isPlatformAdmin,
    status: user.tenant.status,
    mfa: mfaVerified,
  });

  const refreshTokenString = uuidv4();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshTokenString),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
      mfaVerified,
    },
  });

  res.cookie(REFRESH_COOKIE, refreshTokenString, REFRESH_COOKIE_OPTS);
  return accessToken;
}

export async function login(req, res) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    // O compare roda mesmo sem usuário, contra um hash descartável de mesmo
    // custo: sair antes dele deixava o "não existe" muito mais rápido que o
    // "senha errada", e essa diferença de tempo revela quais e-mails têm conta.
    const isValidPassword = await bcrypt.compare(
      password,
      user?.passwordHash || DUMMY_PASSWORD_HASH
    );
    if (!user || !isValidPassword) {
      // Atraso proporcional às falhas já acumuladas por esta conta, aplicado
      // antes da resposta. Chaveado pelo e-mail exista ou não a conta, para não
      // desfazer a paridade de timing conquistada acima.
      await registerLoginFailure(email);
      await applyLoginBackoff(email);
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    // Credencial correta zera o contador: o dono legítimo que errou a senha
    // algumas vezes não deve arrastar atraso pelas próximas 30 min.
    await clearLoginFailures(email);

    if (!user.emailVerified) return res.status(403).json({ error: "E-mail não confirmado.", code: "EMAIL_NOT_VERIFIED" });
    if (!user.active) return res.status(403).json({ error: "Conta desativada.", code: "ACCOUNT_DEACTIVATED" });
    if (user.tenant.status === "SUSPENDED") return res.status(403).json({ error: "Conta suspensa.", code: "ACCOUNT_SUSPENDED" });

    /*
     * Segundo fator: a senha sozinha não abre sessão nenhuma.
     *
     * Nada é emitido aqui além do desafio, que é assinado com um segredo
     * derivado e não serve como token de acesso (ver utils/jwt.js). Emitir a
     * sessão agora e "exigir o TOTP depois" seria fingir um segundo fator: o
     * token já valeria para todo o resto da API.
     */
    if (totpAtivo(user)) {
      const challenge = generateTotpChallenge({ userId: user.id, typ: "totp" });
      return res.json({
        totpRequired: true,
        challenge,
        recuperacaoDisponivel: (user.totpRecoveryCodes || []).length > 0,
      });
    }

    const accessToken = await emitirSessao(res, user);

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

    return res.json({ accessToken });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Dados inválidos." });
    console.error("[Auth] Erro no login:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function refresh(req, res) {
  try {
    // O fallback pelo body existe para facilitar o dev local (Postman, curl sem
    // jar de cookie), mas em produção só vale o cookie httpOnly: aceitar o token
    // no corpo contorna as proteções que o cookie carrega (httpOnly, Secure,
    // SameSite) e permite que ele acabe num log de requisição ou num histórico.
    const refreshTokenString =
      req.cookies?.[REFRESH_COOKIE] ||
      (process.env.NODE_ENV !== "production" ? req.body?.refreshToken : null);
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

    // Revalidação do estado atual do usuário e do escritório.
    //
    // O refresh vale 30 dias e emite um access token novo a cada uso — sem
    // reconferir aqui, uma conta desativada, um e-mail não confirmado ou um
    // tenant suspenso continuariam renovando acesso indefinidamente, porque
    // essas condições só eram checadas no login.
    if (!storedToken.user.active) {
      return res.status(403).json({ error: "Conta desativada.", code: "ACCOUNT_DEACTIVATED" });
    }
    if (!storedToken.user.emailVerified) {
      return res.status(403).json({ error: "E-mail não confirmado.", code: "EMAIL_NOT_VERIFIED" });
    }
    if (storedToken.user.tenant.status === "SUSPENDED") {
      return res.status(403).json({ error: "Conta suspensa.", code: "ACCOUNT_SUSPENDED" });
    }

    // Revogar token atual
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Gerar novos tokens.
    //
    // `mfaVerified` é carregado da sessão que está sendo rotacionada, e não
    // reafirmado: a rotação não pede nada ao usuário, então ela não pode elevar
    // o nível de verificação. Também não pode rebaixá-lo, senão o admin cairia
    // do painel a cada 15 minutos.
    const { user } = storedToken;
    const newAccessToken = await emitirSessao(res, user, {
      mfaVerified: storedToken.mfaVerified,
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
      return res.status(400).json({ error: error.issues[0].message });
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

    const dono = await prisma.user.findUnique({
      where: { id: reset.userId },
      select: { email: true, name: true },
    });
    const politica = await validatePassword(newPassword, dono || {});
    if (!politica.ok) return res.status(400).json({ error: politica.error, code: "WEAK_PASSWORD" });

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
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("[Auth] Erro no reset-password:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function logout(req, res) {
  try {
    const refreshTokenString = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    const accessToken = req.headers.authorization?.split(" ")[1];

    if (refreshTokenString) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshTokenString) },
        data: { revoked: true },
      });
    }

    if (accessToken) {
      // TTL derivado do `exp` do próprio token, não de um 15 min fixo: aumentar
      // JWT_ACCESS_EXPIRES fazia o token sair da blacklist antes de expirar e
      // voltar a ser aceito depois do logout.
      const ttl = accessTokenTtlSeconds(accessToken);
      if (ttl > 0) await redis.setex(`blacklist:${accessToken}`, ttl, "1");
    }

    res.clearCookie(REFRESH_COOKIE, { path: "/" });
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
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0].message });
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

    const politica = await validatePassword(newPassword, { email: user.email, name: user.name });
    if (!politica.ok) return res.status(400).json({ error: politica.error, code: "WEAK_PASSWORD" });

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
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0].message });
    console.error("[Auth] Erro ao trocar senha:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
