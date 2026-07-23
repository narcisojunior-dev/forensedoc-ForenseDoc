import { Router } from "express";
import { handleAsaasWebhook } from "../controllers/webhookController.js";
import { asaasIpAllowlist } from "../middleware/webhookIpAllowlist.js";
import { createLimiter } from "../utils/rateLimitStore.js";

const router = Router();

// A Asaas não usa OAuth/JWT aqui, só o header asaas-access-token — um limite
// generoso evita bloquear picos legítimos de notificação em massa.
const webhookLimiter = createLimiter({
  prefix: "rl:webhook:",
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições." },
});

router.post("/asaas", asaasIpAllowlist, webhookLimiter, handleAsaasWebhook);

export default router;
