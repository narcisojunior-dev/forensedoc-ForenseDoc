import { Router } from "express";
import {
  getPlans,
  getFounderInvite,
  subscribe,
  purchaseAvulso,
  getSubscription,
  upgradeSubscription,
  cancelSubscription,
  getPayments,
  getInvoice,
} from "../controllers/billingController.js";
import { requireAuth } from "../middleware/auth.js";
import { tenantLimiter, founderInviteLimiter } from "../middleware/rateLimiters.js";

const router = Router();

// Pública — precisa ser vista antes do login (landing page / onboarding).
router.get("/plans", getPlans);

// Pública pelo mesmo motivo: o convidado confere o código antes de ter conta.
router.get("/founder-invite/:code", founderInviteLimiter, getFounderInvite);

router.use(requireAuth, tenantLimiter);

router.post("/subscribe", subscribe);
router.post("/avulso", purchaseAvulso);
router.get("/subscription", getSubscription);
router.post("/subscription/upgrade", upgradeSubscription);
router.post("/subscription/cancel", cancelSubscription);
router.get("/payments", getPayments);
router.get("/subscription/invoice", getInvoice);

export default router;
