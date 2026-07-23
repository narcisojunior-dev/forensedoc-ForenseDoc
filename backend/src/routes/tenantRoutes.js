import { Router } from "express";
import { getMembers, inviteMember, getInviteInfo, acceptInvite, removeMember } from "../controllers/tenantController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { createLimiter } from "../utils/rateLimitStore.js";
import { tenantLimiter } from "../middleware/rateLimiters.js";

const router = Router();

const inviteLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
  prefix: "rl:invite:",
});

router.get("/invite/:token", inviteLimiter, getInviteInfo);
router.post("/invite/:token/accept", inviteLimiter, acceptInvite);

router.use(requireAuth, tenantLimiter); // Demais rotas de tenant exigem autenticação

router.get("/members", getMembers);
router.post("/invite", inviteMember);
router.delete("/members/:id", requireRole("OWNER"), removeMember);

export default router;
