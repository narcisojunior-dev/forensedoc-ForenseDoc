import { Router } from "express";
import { analyzePdf, getAnalysisStatus, getAnalysisResult, getAnalysisPdf, correctAnalysisGeo, listAnalyses, getAnalysisStats } from "../controllers/analyzeController.js";
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
import { tenantLimiter, analyzeLimiter } from "../middleware/rateLimiters.js";

const router = Router();

const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 90_000);

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
  requireAuth,
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
router.get("/analyses", requireAuth, tenantLimiter, listAnalyses);

// Rotas Utilitárias
router.get("/geocode", requireAuth, tenantLimiter, geocode);
router.get("/ip/:ip", requireAuth, tenantLimiter, ipLocation);

export default router;

