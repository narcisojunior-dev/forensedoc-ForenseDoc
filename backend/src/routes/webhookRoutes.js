import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { handleAsaasWebhook } from "../controllers/webhookController.js";

const router = Router();

// A Asaas não usa OAuth/JWT aqui, só o header asaas-access-token — um limite
// generoso evita bloquear picos legítimos de notificação em massa.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Muitas requisições." },
});

router.post("/asaas", webhookLimiter, handleAsaasWebhook);

export default router;
