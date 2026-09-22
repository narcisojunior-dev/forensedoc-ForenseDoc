import { Router } from "express";
import {
  createFounderInvites,
  listFounderInvites,
  listTenants,
  getTenant,
  grantManualCredits,
  suspendTenant,
  activateTenant,
  cancelarLaudo,
} from "../controllers/adminController.js";
import {
  getDashboard,
  listPlans,
  updatePlan,
  listAuditLogs,
  listAllPayments,
  getQueueMetrics,
} from "../controllers/adminMetricsController.js";
import { requireAuth, requirePlatformAdmin, requireMfaForAdmin } from "../middleware/auth.js";
import { adminIpAllowlist } from "../middleware/adminIpAllowlist.js";
import { createLimiter } from "../utils/rateLimitStore.js";

const router = Router();

// Rate limit mais rigoroso que o resto da API (M6.1): estas rotas movem
// dinheiro e status de conta, e só existe um operador usando-as.
const adminLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Muitas requisições administrativas. Aguarde um momento." },
  prefix: "rl:admin:",
});

// A allowlist vem DEPOIS do requirePlatformAdmin: quem não é admin recebe o 403
// genérico de sempre e não descobre que existe restrição de origem no painel.
//
// O segundo fator vem depois da allowlist, e pela mesma razão: quem não passa
// da origem não precisa saber que existe TOTP aqui dentro. A ordem também
// economiza a consulta ao banco do `requireMfaForAdmin` para quem já foi
// recusado antes.
router.use(requireAuth, requirePlatformAdmin, adminIpAllowlist, requireMfaForAdmin, adminLimiter);

// Convites do plano fundador
router.get("/founder-invites", listFounderInvites);
router.post("/founder-invites", createFounderInvites);

// Gestão de tenants
router.get("/tenants", listTenants);
router.get("/tenants/:id", getTenant);
router.post("/tenants/:id/credits", grantManualCredits);
router.post("/tenants/:id/suspend", suspendTenant);
router.post("/tenants/:id/activate", activateTenant);

// Cancelamento de laudo. Fica sob /admin, e não sob o tenant, porque desfazer
// a validade pública de um documento já entregue é poder de plataforma.
router.post("/laudos/:codigo/cancelar", cancelarLaudo);

// Métricas do operador (RF-18)
router.get("/dashboard", getDashboard);

// Gestão de planos (RF-20)
router.get("/plans", listPlans);
router.patch("/plans/:id", updatePlan);

// Auditoria e pagamentos
router.get("/audit-logs", listAuditLogs);
router.get("/payments", listAllPayments);

// Operação: estado das filas. Ver comentário em getQueueMetrics sobre por que
// não fica no /health.
router.get("/queues", getQueueMetrics);

export default router;
