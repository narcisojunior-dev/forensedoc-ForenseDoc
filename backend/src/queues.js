import { Queue } from "bullmq";
import "dotenv/config";

// A fila vive num módulo próprio (e não em worker.js) porque tanto quem
// PRODUZ jobs (controllers, services) quanto quem os CONSOME (worker.js)
// precisam dela. Se ela morasse no worker, todo produtor importaria o
// consumidor e criaria ciclos de importação.
export const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

export const QUEUE_NAME = "saas-jobs";

export const saasQueue = new Queue(QUEUE_NAME, { connection });

// BullMQ propaga qualquer erro de conexão do Redis como evento 'error' na
// Queue. Sem um listener, o EventEmitter do Node lança uma exceção não
// tratada e derruba todo o processo (inclusive a API) — nunca deixar sem.
saasQueue.on("error", (err) => {
  console.error(`[Queue] Erro de conexão na fila '${QUEUE_NAME}':`, err.message);
});
