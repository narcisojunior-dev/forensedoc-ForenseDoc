import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getMembers, inviteMember, getInviteInfo, acceptInvite, removeMember } from "../controllers/tenantController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { redis } from "../utils/redis.js";

const router = Router();

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: "rl:invite:" }),
});

router.get("/invite/:token", inviteLimiter, getInviteInfo);
router.post("/invite/:token/accept", inviteLimiter, acceptInvite);

router.use(requireAuth); // Demais rotas de tenant exigem autenticação

router.get("/members", getMembers);
router.post("/invite", inviteMember);
router.delete("/members/:id", requireRole("OWNER"), removeMember);

export default router;
