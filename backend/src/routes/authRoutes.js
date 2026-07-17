import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { register, login, refresh, verifyEmail, logout, me, forgotPassword, resetPassword, updateProfile, changePassword } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import { redis } from "../utils/redis.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: "rl:login:" }),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Limite de registros excedido. Tente novamente mais tarde." },
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: "rl:register:" }),
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: "Limite de solicitações excedido. Tente novamente mais tarde." },
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: "rl:forgot:" }),
});

// Rotas Públicas
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/refresh", refresh);
router.post("/verify-email", verifyEmail);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPassword);

// Rotas Protegidas
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateProfile);
router.post("/change-password", requireAuth, changePassword);

export default router;
