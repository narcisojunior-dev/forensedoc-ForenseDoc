import { Router } from "express";
import { register, login, refresh, verifyEmail, logout, me, forgotPassword, resetPassword, updateProfile, changePassword } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { createLimiter } from "../utils/rateLimitStore.js";

const router = Router();

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
  prefix: "rl:login:",
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

// Rotas Públicas
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
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
