import { timingSafeEqual } from "node:crypto";
import { paymentsQueue } from "../queues.js";

/**
 * Compara o token do header com o configurado sem vazar pelo tempo de resposta
 * o quanto os dois coincidem. `timingSafeEqual` exige buffers do mesmo
 * tamanho, então o comprimento é conferido antes — essa diferença sozinha não
 * ajuda quem tenta adivinhar um segredo aleatório.
 */
function tokenMatches(received) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected || typeof received !== "string") return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Teto de espera pelo enfileiramento.
 *
 * Com o Redis fora do ar, o ioredis por baixo do BullMQ fica retentando a
 * conexão em vez de falhar — sem este limite a requisição pendura até a Asaas
 * desistir do outro lado, segurando conexão à toa. Falhar rápido com 500 leva
 * ao mesmo resultado útil (a Asaas reenvia) sem a espera.
 */
const ENQUEUE_TIMEOUT_MS = Number(process.env.WEBHOOK_ENQUEUE_TIMEOUT_MS || 5000);

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("ENQUEUE_TIMEOUT")), ms).unref()
    ),
  ]);
}

export async function handleAsaasWebhook(req, res) {
  if (!tokenMatches(req.headers["asaas-access-token"])) {
    return res.status(401).end();
  }

  // O 200 só sai DEPOIS de o job estar na fila. Responder antes trocava a
  // latência da Asaas por perda silenciosa de pagamento: com o Redis fora do
  // ar, a falha do enqueue era apenas logada e a Asaas, já tendo recebido 200,
  // nunca reenviava — o cliente pagava e não recebia crédito.
  try {
    await withTimeout(
      paymentsQueue.add("process-webhook", req.body, {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      }),
      ENQUEUE_TIMEOUT_MS
    );
  } catch (err) {
    console.error("[Webhook] Erro ao enfileirar processamento:", err.message);
    // 500 faz a Asaas reenviar o evento. A repetição é segura porque o
    // processamento é idempotente (webhookProcessor.handlePaymentReceived).
    return res.status(500).end();
  }

  return res.status(200).end();
}
