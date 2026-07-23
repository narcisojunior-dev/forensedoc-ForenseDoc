import { Router } from "express";
import { getBalance, getTransactions } from "../controllers/creditController.js";
import { requireAuth } from "../middleware/auth.js";
import { tenantLimiter } from "../middleware/rateLimiters.js";

const router = Router();

router.use(requireAuth, tenantLimiter); // Todas as rotas de créditos exigem autenticação

router.get("/balance", getBalance);
router.get("/transactions", getTransactions);

export default router;
