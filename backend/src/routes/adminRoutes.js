import { Router } from "express";
import {
  createFounderInvites,
  listFounderInvites,
  listTenants,
  getTenant,
  grantManualCredits,
  suspendTenant,
  activateTenant,
} from "../controllers/adminController.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { createLimiter } from "../utils/rateLimitStore.js";

const router = Router();

// Rate limit mais rigoroso que o resto da API (M6.1): estas rotas movem
// dinheiro e status de conta, e só existe um operador usando-as.
const adminLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Muitas requisições administrativas. Aguarde um momento." },
  prefix: "rl:admin:",
});

router.use(requireAuth, requirePlatformAdmin, adminLimiter);

// Convites do plano fundador
router.get("/founder-invites", listFounderInvites);
router.post("/founder-invites", createFounderInvites);

// Gestão de tenants
router.get("/tenants", listTenants);
router.get("/tenants/:id", getTenant);
router.post("/tenants/:id/credits", grantManualCredits);
router.post("/tenants/:id/suspend", suspendTenant);
router.post("/tenants/:id/activate", activateTenant);

export default router;
