import { Router } from "express";
import { analyzePdf, getAnalysisStatus, getAnalysisResult, listAnalyses } from "../controllers/analyzeController.js";
import { geocode, ipLocation } from "../controllers/geoController.js";
import authRoutes from "./authRoutes.js";
import tenantRoutes from "./tenantRoutes.js";
import creditRoutes from "./creditRoutes.js";
import billingRoutes from "./billingRoutes.js";
import webhookRoutes from "./webhookRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import { requireAuth } from "../middleware/auth.js";
import { requireCredit } from "../middleware/creditGuard.js";

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
router.use("/auth", authRoutes);
router.use("/tenant", tenantRoutes);
router.use("/credits", creditRoutes);
router.use("/billing", billingRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/notifications", notificationRoutes);

// Rotas de Análise (Módulo 4 — assíncrono via BullMQ, ver worker.js)
router.post("/analyze", requireAuth, requireCredit, requestTimeout(ANALYZE_TIMEOUT_MS), analyzePdf);
router.get("/analyses/:id/status", requireAuth, getAnalysisStatus);
router.get("/analyses/:id/result", requireAuth, getAnalysisResult);
router.get("/analyses", requireAuth, listAnalyses);

// Rotas Utilitárias
router.get("/geocode", requireAuth, geocode);
router.get("/ip/:ip", requireAuth, ipLocation);

export default router;

