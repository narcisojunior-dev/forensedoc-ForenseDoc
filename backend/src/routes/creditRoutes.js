import { Router } from "express";
import { getBalance, getTransactions } from "../controllers/creditController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth); // Todas as rotas de créditos exigem autenticação

router.get("/balance", getBalance);
router.get("/transactions", getTransactions);

export default router;
