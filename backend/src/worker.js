import "dotenv/config";
import { Worker } from "bullmq";
import { saasQueue, connection, QUEUE_NAME } from "./queues.js";
import { processCreditExpirations } from "./jobs/expireCredits.js";
import { processWebhook, suspendIfStillOverdue } from "./jobs/webhookProcessor.js";
import { processAnalysis } from "./jobs/analysisWorker.js";
import { processEmail } from "./jobs/emailWorker.js";
import { processRenewalReminders, processOverdueReminders } from "./jobs/reminders.js";

// A fila em si vive em ./queues.js — produtores (controllers, services) e
// consumidor (este arquivo) precisam dela, e mantê-la aqui criava ciclos de
// importação. Reexportada por compatibilidade com quem já importava daqui.
export { saasQueue };

console.log(`[ForenseDoc v3.0] Worker iniciado. Aguardando jobs da fila '${QUEUE_NAME}'...`);

const HANDLERS = {
  "expire-credits": () => processCreditExpirations(),
  "process-webhook": (job) => processWebhook(job),
  "suspend-if-overdue": (job) => suspendIfStillOverdue(job.data.tenantId),
  "process-pdf": (job) => processAnalysis(job),
  "send-email": (job) => processEmail(job),
  "renewal-reminders": () => processRenewalReminders(),
  "overdue-reminders": () => processOverdueReminders(),
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = HANDLERS[job.name];
    if (!handler) {
      console.warn(`[Worker] Job sem handler registrado: ${job.name}`);
      return;
    }
    return handler(job);
  },
  { connection }
);

worker.on("error", (err) => {
  console.error("[Worker] Erro de conexão no worker:", err.message);
});

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.name} (ID: ${job.id}) concluído com sucesso.`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.name} (ID: ${job?.id}) falhou:`, err);
});

// ─── Cron Jobs (BullMQ Repeatable Jobs) ──────────────────────────────────────
// O jobId fixo garante um único agendamento por cron, mesmo com várias
// instâncias do worker subindo em paralelo.
const CRONS = [
  // Expira créditos mensais de ciclos encerrados.
  { name: "expire-credits", pattern: "0 2 * * *", jobId: "cron-expire-credits" },
  // Avisa quem renova em 3 dias (M7.3).
  { name: "renewal-reminders", pattern: "0 9 * * *", jobId: "cron-renewal-reminders" },
  // Cobra quem está em atraso há 3+ dias, antes da suspensão no 7º dia (M7.3).
  { name: "overdue-reminders", pattern: "30 9 * * *", jobId: "cron-overdue-reminders" },
];

for (const cron of CRONS) {
  saasQueue
    .add(cron.name, {}, { repeat: { pattern: cron.pattern }, jobId: cron.jobId })
    .catch((err) => {
      console.error(`[Worker] Erro ao agendar cron '${cron.name}':`, err.message);
    });
}
