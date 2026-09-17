import { Router, json } from "express";
import {
  startReplica,
  listReplicas,
  getReplica,
  draftReplica,
  deleteReplica,
  listScenarios,
  REPLICA_MAX_TOTAL_MB,
} from "../controllers/replicaController.js";
import { requireAuth } from "../middleware/auth.js";
import { tenantLimiter, analyzeLimiter } from "../middleware/rateLimiters.js";

const router = Router();

/*
 * Parser próprio da rota que recebe os autos em base64, pelo mesmo motivo da
 * rota de análise: o limite global é 1 MB. O teto bruto acompanha o total
 * permitido, com folga para o inchaço do base64; a mensagem legível sobre
 * tamanho vem da validação do controller.
 */
const replicaBodyParser = json({ limit: `${Math.ceil(REPLICA_MAX_TOTAL_MB * 1.4) + 1}mb` });
const draftBodyParser = json({ limit: "256kb" });

// requireAuth antes do parser: requisição anônima não pode materializar dezenas
// de megabytes de base64 só para receber 401.
router.post("/", requireAuth, replicaBodyParser, analyzeLimiter, startReplica);
router.get("/", requireAuth, tenantLimiter, listReplicas);
// Estática antes da paramétrica, senão "scenarios" seria lido como id.
router.get("/scenarios", requireAuth, tenantLimiter, listScenarios);
router.get("/:id", requireAuth, tenantLimiter, getReplica);
router.post("/:id/draft", requireAuth, draftBodyParser, tenantLimiter, draftReplica);
router.delete("/:id", requireAuth, tenantLimiter, deleteReplica);

export default router;
