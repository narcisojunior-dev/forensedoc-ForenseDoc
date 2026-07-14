import "dotenv/config";
import { Worker, Queue } from "bullmq";
import { processCreditExpirations } from "./jobs/expireCredits.js";

// Conexão do Redis para o BullMQ
const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

// 1. Definição da Fila Principal (SaaS)
export const saasQueue = new Queue("saas-jobs", { connection });

console.log("[ForenseDoc v3.0] Worker iniciado. Aguardando jobs da fila 'saas-jobs'...");

// 2. Configuração do Worker (processador de jobs)
const worker = new Worker("saas-jobs", async (job) => {
  if (job.name === "expire-credits") {
    await processCreditExpirations();
  }
  // Módulo 4: job de análise de PDF será adicionado aqui depois
}, { connection });

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.name} (ID: ${job.id}) concluído com sucesso.`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.name} (ID: ${job?.id}) falhou:`, err);
});

// 3. Agendamento do Cron Job (BullMQ Repeatable Jobs)
// Roda toda madrugada às 02:00h
saasQueue.add(
  "expire-credits",
  {},
  {
    repeat: { pattern: "0 2 * * *" },
    jobId: "cron-expire-credits" // garante que só haverá 1 agendamento desse cron
  }
);
