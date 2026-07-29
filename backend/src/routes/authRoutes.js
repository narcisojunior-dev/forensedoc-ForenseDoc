import { Router } from "express";
import { register, login, refresh, verifyEmail, logout, me, forgotPassword, resetPassword, updateProfile, changePassword } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { csrfGuard } from "../middleware/csrfGuard.js";
import { createLimiter } from "../utils/rateLimitStore.js";
import { normalizeEmail } from "../utils/stringUtils.js";

const router = Router();

/**
 * Limite por IP: protege a infraestrutura contra um atacante único e barulhento.
 */
const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
  prefix: "rl:login:",
});

/**
 * Bloqueio por CONTA — a defesa que faltava (N1 da auditoria).
 *
 * O limite por IP protege a infraestrutura, não a conta: com IPs rotativos
 * (botnet ou proxies residenciais), 500 origens davam 5.000 tentativas por
 * janela contra um único e-mail sem nunca disparar bloqueio. A chave aqui é a
 * identidade, então trocar de rede não zera o contador.
 *
 * `skipSuccessfulRequests` é o que torna isto seguro de usar: só falha conta.
 * Sem ele, quem usa a própria conta normalmente gastaria a cota e se trancaria
 * fora — e o bloqueio viraria uma negação de serviço contra o dono legítimo.
 *
 * Contrapartida assumida: um atacante que saiba o e-mail da vítima consegue
 * mantê-la bloqueada gastando 5 tentativas a cada 30 min. É o trade-off padrão
 * de lockout; a janela curta limita o estrago, e o dono continua com o fluxo de
 * recuperação de senha disponível (que tem limitador próprio).
 */
const accountLoginLimiter = createLimiter({
  windowMs: 30 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `acct:${normalizeEmail(req.body?.email)}`,
  // Sem e-mail no corpo, a chave seria `acct:` para todo mundo — um balde
  // compartilhado que qualquer um poderia esgotar para bloquear os demais.
  // Estas requisições já morrem na validação do Zod; o limite por IP cobre.
  skip: (req) => !req.body?.email || typeof req.body.email !== "string",
  skipSuccessfulRequests: true,
  message: {
    error:
      "Muitas tentativas de login para esta conta. Aguarde 30 minutos ou redefina sua senha.",
    code: "ACCOUNT_TEMPORARILY_LOCKED",
  },
  prefix: "rl:login:acct:",
});

const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Limite de registros excedido. Tente novamente mais tarde." },
  prefix: "rl:register:",
});

const forgotPasswordLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: "Limite de solicitações excedido. Tente novamente mais tarde." },
  prefix: "rl:forgot:",
});

/**
 * Rotas que consomem token (refresh, verificação de e-mail, redefinição).
 *
 * Os tokens são UUIDv4 e não se adivinham por força bruta, mas cada tentativa
 * custa uma consulta ao banco — sem limite, dá para saturar o Postgres de fora.
 * O teto é folgado de propósito: o refresh legítimo acontece a cada 15 minutos,
 * e um limite apertado quebraria quem mantém várias abas abertas.
 */
const tokenLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
  prefix: "rl:token:",
});

// As rotas de auth autenticam por COOKIE (refresh/logout), então são as únicas
// alcançáveis por uma requisição forjada de outro site. O guard de origem é a
// segunda camada, independente do SameSite do navegador.
router.use(csrfGuard);

// Rotas Públicas
router.post("/register", registerLimiter, register);
// Duas camadas: IP (infra) e conta (credencial). Ambas precisam passar.
router.post("/login", loginLimiter, accountLoginLimiter, login);
router.post("/refresh", tokenLimiter, refresh);
router.post("/verify-email", tokenLimiter, verifyEmail);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", tokenLimiter, resetPassword);

// Rotas Protegidas
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateProfile);
router.post("/change-password", requireAuth, changePassword);

export default router;
