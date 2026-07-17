import { saasQueue } from "../worker.js";

export async function handleAsaasWebhook(req, res) {
  const token = req.headers["asaas-access-token"];
  if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return res.status(401).end();
  }

  // Responder rápido — a Asaas tem timeout curto e vai reenviar se não
  // receber 200 a tempo. O processamento real acontece no worker.
  res.status(200).end();

  await saasQueue
    .add("process-webhook", req.body, {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
    })
    .catch((err) => {
      console.error("[Webhook] Erro ao enfileirar processamento:", err.message);
    });
}
