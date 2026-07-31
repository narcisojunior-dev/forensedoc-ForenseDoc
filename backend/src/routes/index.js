import { Router, json } from "express";
import { analyzePdf, getAnalysisStatus, getAnalysisResult, getAnalysisPdf, correctAnalysisGeo, reviewAnalysisFields, listReviewableFields, listAnalyses, getAnalysisStats } from "../controllers/analyzeController.js";
import { geocode, ipLocation } from "../controllers/geoController.js";
import authRoutes from "./authRoutes.js";
import tenantRoutes from "./tenantRoutes.js";
import creditRoutes from "./creditRoutes.js";
import billingRoutes from "./billingRoutes.js";
import webhookRoutes from "./webhookRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import adminRoutes from "./adminRoutes.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCredit } from "../middleware/creditGuard.js";
import { tenantLimiter, analyzeLimiter, externalApiLimiter } from "../middleware/rateLimiters.js";

const router = Router();

const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 90_000);

/**
 * Parser exclusivo da rota de análise — a única que recebe PDF em base64.
 *
 * O limite global do server.js é 1 MB; aqui ele sobe para acomodar o
 * MAX_PDF_MB (padrão 30), com folga para o inchaço de ~33% do base64 e para o
 * resto do JSON. `validatePdfPayload` continua sendo quem recusa o arquivo
 * grande com mensagem própria — este limite é só o teto bruto do transporte.
 */
const MAX_PDF_MB = Number(process.env.MAX_PDF_MB || 30);
const analyzeBodyParser = json({ limit: `${Math.ceil(MAX_PDF_MB * 1.4) + 1}mb` });

function requestTimeout(ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: "Timeout: processamento excedeu o limite de tempo." });
      }
    }, ms);
    timer.unref();
    res.on("finish", () => clearTimeout(timer));
    next();
  };
}

// Rotas Base
// /auth e /webhooks ficam de fora do tenantLimiter: têm limitadores próprios
// por IP e, no caso do webhook, quem chama é a Asaas (sem tenant no request).
router.use("/auth", authRoutes);
router.use("/webhooks", webhookRoutes);

// Os demais aplicam requireAuth + tenantLimiter internamente (o limitador
// precisa do req.tenantId que o requireAuth injeta).
router.use("/tenant", tenantRoutes);
router.use("/credits", creditRoutes);
router.use("/billing", billingRoutes);
router.use("/notifications", notificationRoutes);
router.use("/admin", adminRoutes);

// Rotas de Análise (Módulo 4 — assíncrono via BullMQ, ver worker.js)
router.post(
  "/analyze",
  // requireAuth ANTES do parser: ele lê só o header Authorization, então não
  // precisa do corpo. Na ordem inversa, uma requisição anônima fazia o servidor
  // materializar até 42 MB de base64 na memória para só então devolver 401 —
  // trabalho pesado concedido a quem sequer tem conta.
  requireAuth,
  analyzeBodyParser, // única rota que aceita corpo acima do limite global
  analyzeLimiter, // anti-duplo-clique: 1 análise / 30s por tenant
  requireCredit,
  requestTimeout(ANALYZE_TIMEOUT_MS),
  analyzePdf
);
// Antes das rotas com `:id` para que "stats" não seja lido como um id.
router.get("/analyses/stats", requireAuth, tenantLimiter, getAnalysisStats);
router.get("/analyses/:id/status", requireAuth, tenantLimiter, getAnalysisStatus);
router.get("/analyses/:id/result", requireAuth, tenantLimiter, getAnalysisResult);
router.get("/analyses/:id/pdf", requireAuth, tenantLimiter, getAnalysisPdf);
router.patch("/analyses/:id/geo", requireAuth, tenantLimiter, correctAnalysisGeo);

// Revisão dos campos extraídos antes de emitir o laudo. Fora da fila de
// propósito: é escrita no banco mais recálculo local, perfil oposto ao da
// análise, que é CPU pesada por minutos. Ver o comentário em
// `reviewAnalysisFields` sobre a conformidade com a separação de filas.
//
// A rota estática vem ANTES da paramétrica: registrada depois, "/analyses/:id"
// capturaria "reviewable-fields" como se fosse um id.
router.get("/analyses/reviewable-fields", requireAuth, tenantLimiter, listReviewableFields);
router.patch("/analyses/:id/fields", requireAuth, tenantLimiter, reviewAnalysisFields);
router.get("/analyses", requireAuth, tenantLimiter, listAnalyses);

// Rotas Utilitárias
router.get("/geocode", requireAuth, tenantLimiter, externalApiLimiter, geocode);
router.get("/ip/:ip", requireAuth, tenantLimiter, externalApiLimiter, ipLocation);

export default router;

