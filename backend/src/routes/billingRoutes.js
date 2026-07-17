import { Router } from "express";
import {
  getPlans,
  subscribe,
  purchaseAvulso,
  getSubscription,
  upgradeSubscription,
  cancelSubscription,
  getPayments,
  getInvoice,
} from "../controllers/billingController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Pública — precisa ser vista antes do login (landing page / onboarding).
router.get("/plans", getPlans);

router.use(requireAuth);

router.post("/subscribe", subscribe);
router.post("/avulso", purchaseAvulso);
router.get("/subscription", getSubscription);
router.post("/subscription/upgrade", upgradeSubscription);
router.post("/subscription/cancel", cancelSubscription);
router.get("/payments", getPayments);
router.get("/subscription/invoice", getInvoice);

export default router;
