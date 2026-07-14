import { Router } from "express";
import { analyzePdf } from "../controllers/analyzeController.js";
import { geocode, ipLocation } from "../controllers/geoController.js";
import authRoutes from "./authRoutes.js";
import tenantRoutes from "./tenantRoutes.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Rotas de Autenticação e Tenant
router.use("/auth", authRoutes);
router.use("/tenant", tenantRoutes);

// Rotas de Análise (v2.2 mantida, precisará de adaptação no Módulo 4)
router.post("/analyze", requireAuth, analyzePdf);

// Rotas Utilitárias
router.get("/geocode", requireAuth, geocode);
router.get("/ip/:ip", requireAuth, ipLocation);

export default router;

