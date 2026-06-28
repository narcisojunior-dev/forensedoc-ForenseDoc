import { Router } from "express";
import { analyzePdf } from "../controllers/analyzeController.js";
import { geocode, ipLocation } from "../controllers/geoController.js";

const router = Router();

router.post("/analyze", analyzePdf);
router.get("/geocode", geocode);
router.get("/ip/:ip", ipLocation);
router.get("/health", (_req, res) => res.json({
  ok: true,
  mode: "local",
  analyzer: "pdf-text+ocr",
}));

export default router;
