import { Router } from "express";
import { consultarLaudo } from "../controllers/verificacaoController.js";
import { verificacaoLimiter } from "../middleware/rateLimiters.js";

/**
 * Rotas sem autenticação.
 *
 * O prefixo `/public` é literal de propósito: quem ler o roteador tem que ver
 * de imediato que ali dentro nada exige sessão, em vez de descobrir isso
 * conferindo middleware por middleware.
 */
const router = Router();

router.get("/laudos/:chave", verificacaoLimiter, consultarLaudo);

export default router;
