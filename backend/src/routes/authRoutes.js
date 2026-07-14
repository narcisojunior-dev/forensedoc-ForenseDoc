import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { register, login, refresh, verifyEmail, logout, me } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
// import { RedisStore } from "rate-limit-redis";
// import { redis } from "../utils/redis.js";

const router = Router();

// Configuração básica de rate limit (idealmente usar RedisStore em prod)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 tentativas
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
  // store: new RedisStore({ sendCommand: (...args) => redis.call(...args) })
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // 5 registros
  message: { error: "Limite de registros excedido. Tente novamente mais tarde." },
});

// Rotas Públicas
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/refresh", refresh);
router.post("/verify-email", verifyEmail);

// Rotas Protegidas
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);

export default router;
