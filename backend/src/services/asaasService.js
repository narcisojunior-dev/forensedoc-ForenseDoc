const ASAAS_BASE =
  process.env.ASAAS_ENV === "production"
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/api/v3";

class AsaasError extends Error {
  constructor(body) {
    super(body?.errors?.[0]?.description || "Erro na API da Asaas.");
    this.name = "AsaasError";
    this.details = body;
  }
}

// Nunca logar process.env.ASAAS_API_KEY nem o corpo bruto de erro (pode ecoar
// dados do cliente) — apenas a mensagem já extraída em AsaasError.
async function asaasRequest(method, path, body) {
  const res = await fetch(`${ASAAS_BASE}${path}`, {
    method,
    headers: {
      access_token: process.env.ASAAS_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new AsaasError(errBody);
  }

  return res.json();
}

export async function createAsaasCustomer(tenant) {
  return asaasRequest("POST", "/customers", {
    name: tenant.name,
    cpfCnpj: tenant.cpfCnpj,
  });
}

// cycleType: "MONTHLY" ou "YEARLY"
export async function createSubscription(customerId, plan, billingType, isAnnual) {
  const value = isAnnual ? Number(plan.priceBrl) * 10 : Number(plan.priceBrl);
  const nextDueDate = new Date();
  nextDueDate.setDate(nextDueDate.getDate() + 1);

  return asaasRequest("POST", "/subscriptions", {
    customer: customerId,
    billingType, // "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED"
    value,
    nextDueDate: nextDueDate.toISOString().slice(0, 10),
    cycle: isAnnual ? "YEARLY" : "MONTHLY",
    description: `ForenseDoc — Plano ${plan.name}`,
  });
}

export async function createAvulsoPayment(customerId, amount, billingType) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);

  return asaasRequest("POST", "/payments", {
    customer: customerId,
    billingType,
    value: amount,
    dueDate: dueDate.toISOString().slice(0, 10),
    description: "ForenseDoc — Crédito avulso",
  });
}

export async function cancelSubscription(asaasSubscriptionId) {
  return asaasRequest("DELETE", `/subscriptions/${asaasSubscriptionId}`);
}

export async function getPayment(asaasPaymentId) {
  return asaasRequest("GET", `/payments/${asaasPaymentId}`);
}
