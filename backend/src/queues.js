import { Queue } from "bullmq";
import "dotenv/config";

/**
 * Filas do ForenseDoc, separadas por NATUREZA do trabalho.
 *
 * As filas vivem num módulo próprio (e não em worker.js) porque tanto quem
 * PRODUZ jobs (controllers, services) quanto quem os CONSOME (worker.js)
 * precisam delas. Se morassem no worker, todo produtor importaria o consumidor
 * e criaria ciclos de importação.
 *
 * ─── Por que não é mais uma fila só ──────────────────────────────────────────
 *
 * Havia uma fila única (`saas-jobs`) consumida por um worker de concorrência 1,
 * que é o default do BullMQ quando o valor não é informado. Análise, webhook de
 * pagamento, e-mail e rotina agendada disputavam o mesmo slot, em ordem de
 * chegada.
 *
 * O efeito prático não era lentidão distribuída, era inversão de prioridade: uma
 * análise com OCR (medida em até 112 segundos) BLOQUEAVA a confirmação de
 * pagamento que chegasse atrás dela. O cliente pagava, a Asaas entregava o
 * webhook, e o crédito só entrava quando o OCR de outro cliente terminasse.
 *
 * Trabalhos com perfis tão diferentes não podem compartilhar fila:
 *
 *   análise   CPU pesada, de segundos a minutos, tolera espera
 *   pagamento I/O leve, milissegundos, NÃO tolera espera (é dinheiro entrando)
 *   e-mail    I/O externo, falha de forma transitória, precisa de retry
 *   cron      raro, previsível, roda de madrugada
 *
 * Cada fila tem a sua concorrência (ver `worker.js`), então saturar uma não
 * afeta as outras.
 */

export const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

export const QUEUE_NAMES = {
  analysis: "forensedoc-analysis",
  payments: "forensedoc-payments",
  emails: "forensedoc-emails",
  crons: "forensedoc-crons",
};

/**
 * BullMQ propaga erro de conexão do Redis como evento 'error' na Queue. Sem um
 * listener, o EventEmitter do Node lança exceção não tratada e derruba o
 * processo inteiro, inclusive a API. Nunca deixar uma fila sem.
 */
function criarFila(nome) {
  const fila = new Queue(nome, { connection });
  fila.on("error", (err) => {
    console.error(`[Queue] Erro de conexão na fila '${nome}':`, err.message);
  });
  return fila;
}

export const analysisQueue = criarFila(QUEUE_NAMES.analysis);
export const paymentsQueue = criarFila(QUEUE_NAMES.payments);
export const emailsQueue = criarFila(QUEUE_NAMES.emails);
export const cronsQueue = criarFila(QUEUE_NAMES.crons);

/** Todas as filas, para métricas e encerramento ordenado. */
export const ALL_QUEUES = [analysisQueue, paymentsQueue, emailsQueue, cronsQueue];
