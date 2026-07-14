import { hasCredit } from "../services/creditService.js";

export async function requireCredit(req, res, next) {
  try {
    const tenantId = req.tenantId; // Injetado pelo requireAuth
    if (!tenantId) {
      return res.status(401).json({ error: "Não autenticado ou sem tenantId." });
    }

    const canProceed = await hasCredit(tenantId);
    
    if (!canProceed) {
      return res.status(402).json({ 
        error: "Saldo de créditos insuficiente. Recarregue sua conta para continuar.",
        code: "INSUFFICIENT_CREDITS" 
      });
    }

    next();
  } catch (error) {
    console.error("[CreditGuard] Erro ao verificar saldo:", error);
    return res.status(500).json({ error: "Erro ao verificar saldo de créditos." });
  }
}
