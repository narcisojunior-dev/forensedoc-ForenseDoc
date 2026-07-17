import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { getMembers, inviteMember, getInviteInfo, acceptInvite, removeMember } from "../controllers/tenantController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Convites: usuário ainda não tem conta, então não passam por requireAuth.
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." },
});

router.get("/invite/:token", inviteLimiter, getInviteInfo);
router.post("/invite/:token/accept", inviteLimiter, acceptInvite);

router.use(requireAuth); // Demais rotas de tenant exigem autenticação

router.get("/members", getMembers);
router.post("/invite", inviteMember);
router.delete("/members/:id", requireRole("OWNER"), removeMember);

export default router;
