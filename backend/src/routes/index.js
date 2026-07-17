import { Router } from "express";
import { analyzePdf } from "../controllers/analyzeController.js";
import { geocode, ipLocation } from "../controllers/geoController.js";
import authRoutes from "./authRoutes.js";
import tenantRoutes from "./tenantRoutes.js";
import creditRoutes from "./creditRoutes.js";
import { requireAuth } from "../middleware/auth.js";

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

// Rotas de Análise (v2.2 mantida, precisará de adaptação no Módulo 4)
router.post("/analyze", requireAuth, requestTimeout(ANALYZE_TIMEOUT_MS), analyzePdf);

// Rotas Utilitárias
router.get("/geocode", requireAuth, geocode);
router.get("/ip/:ip", requireAuth, ipLocation);

export default router;

