import { Router } from "express";
import { getMembers, inviteMember } from "../controllers/tenantController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth); // Todas as rotas de tenant exigem autenticação

router.get("/members", getMembers);
router.post("/invite", inviteMember);

export default router;
