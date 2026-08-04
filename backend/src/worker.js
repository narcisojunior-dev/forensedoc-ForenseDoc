import "dotenv/config";
import os from "node:os";
import { Worker } from "bullmq";
import { analysisQueue, cronsQueue, connection, QUEUE_NAMES } from "./queues.js";
import { processCreditExpirations } from "./jobs/expireCredits.js";
import { processWebhook, suspendIfStillOverdue } from "./jobs/webhookProcessor.js";
import { processAnalysis } from "./jobs/analysisWorker.js";
import { processEmail } from "./jobs/emailWorker.js";
import { processRenewalReminders, processOverdueReminders } from "./jobs/reminders.js";
import { startQueueWatch } from "./services/queueMetricsService.js";
import { processUploadPurge } from "./jobs/purgeUploads.js";
import { processRecordPurge } from "./jobs/purgeRecords.js";
import { ensureStorageReady } from "./services/objectStorageService.js";
import { avisarSeServicoPublico } from "./services/nominatimClient.js";

// Reexportadas por compatibilidade com quem já importava daqui.
export { analysisQueue };

/**
 * ─── Concorrência por fila ───────────────────────────────────────────────────
 *
 * O worker anterior era `new Worker(nome, handler, { connection })`, sem a opção
 * `concurrency`. O BullMQ assume 1 nesse caso, então a plataforma INTEIRA
 * processava um job por vez, qualquer que fosse o tipo.
 *
 * Os valores abaixo seguem o perfil de cada trabalho:
 *
 * ANÁLISE é limitada por CPU e por memória. O OCR usa Tesseract, que satura um
 * núcleo por página, e a rasterização por pdftoppm também. Passar de um job por
 * núcleo não aumenta a vazão: só faz todos ficarem mais lentos ao mesmo tempo.
 * O default parte de núcleos menos um, mas com o teto explicado logo abaixo.
 *
 * PAGAMENTO é I/O leve e não pode esperar: são poucos milissegundos de banco por
 * job, e cada segundo de atraso é crédito que o cliente pagou e ainda não
 * recebeu. Concorrência alta aqui custa quase nada.
 *
 * E-MAIL depende de SMTP externo, que é lento e falha de forma transitória.
 * Vale paralelismo moderado, limitado pelo que o provedor aceita sem tratar como
 * abuso.
 *
 * CRON roda de madrugada e não concorre com nada. Fica em 1 de propósito: são
 * rotinas que varrem tabelas inteiras, e duas ao mesmo tempo só disputam banco.
 */
const NUCLEOS = Math.max(1, os.cpus()?.length || 1);

/*
 * Teto de memória na análise, não só de CPU.
 *
 * Cada job de análise carrega, ao mesmo tempo: o PDF em base64 vindo do payload
 * (até ~40 MB), o buffer decodificado (até 30 MB), as páginas rasterizadas e um
 * worker do Tesseract com os dados de idioma carregados. É fácil passar de
 * 150 MB por job.
 *
 * Num host de 10 núcleos, `núcleos - 1` daria 9 jobs simultâneos e um pico
 * próximo de 1,4 GB só de análise. Numa VPS de 2 GB isso derruba o processo por
 * falta de memória, e o sintoma (worker reiniciando) não aponta para a causa.
 *
 * O teto de 4 é conservador de propósito, e a razão é MEMÓRIA, não CPU. A curva
 * de saturação medida (ver ESCALABILIDADE.md §2.2) mostra a vazão ainda subindo
 * em 6, com 29% de ganho sobre 4, então este valor NÃO é o pico de desempenho:
 * é um ponto de partida seguro para host desconhecido.
 *
 * Suba via WORKER_CONCURRENCY_ANALYSIS depois de rodar scripts/testeDeCarga.mjs
 * no host real, observando o pico de memória junto da vazão. O caminho de escala
 * preferido continua sendo aumentar réplicas do container, que distribui memória
 * entre hosts em vez de concentrar num só.
 */
const MAX_ANALISE_PADRAO = 4;

const CONCORRENCIA = {
  analysis:
    Number(process.env.WORKER_CONCURRENCY_ANALYSIS) ||
    Math.min(MAX_ANALISE_PADRAO, Math.max(1, NUCLEOS - 1)),
  payments: Number(process.env.WORKER_CONCURRENCY_PAYMENTS) || 10,
  emails: Number(process.env.WORKER_CONCURRENCY_EMAILS) || 5,
  crons: 1,
};

/**
 * Handlers por fila. O mapeamento é explícito para que um job enfileirado na
 * fila errada falhe de forma visível, em vez de ser processado fora do seu
 * regime de concorrência.
 */
const HANDLERS = {
  [QUEUE_NAMES.analysis]: {
    "process-pdf": (job) => processAnalysis(job),
  },
  [QUEUE_NAMES.payments]: {
    "process-webhook": (job) => processWebhook(job),
    "suspend-if-overdue": (job) => suspendIfStillOverdue(job.data.tenantId),
  },
  [QUEUE_NAMES.emails]: {
    "send-email": (job) => processEmail(job),
  },
  [QUEUE_NAMES.crons]: {
    "expire-credits": () => processCreditExpirations(),
    "renewal-reminders": () => processRenewalReminders(),
    "overdue-reminders": () => processOverdueReminders(),
    "purge-uploads": () => processUploadPurge(),
    "purge-records": () => processRecordPurge(),
  },
};

const workers = [];

for (const [chave, nomeFila] of Object.entries(QUEUE_NAMES)) {
  const handlers = HANDLERS[nomeFila];
  const concurrency = CONCORRENCIA[chave];

  const worker = new Worker(
    nomeFila,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) {
        // Enfileirado na fila errada, ou handler removido sem limpar a fila.
        // Falhar é melhor que ignorar: o job some da fila e ninguém percebe.
        throw new Error(`Job '${job.name}' não tem handler na fila '${nomeFila}'`);
      }
      return handler(job);
    },
    { connection, concurrency }
  );

  worker.on("error", (err) => {
    console.error(`[Worker:${nomeFila}] Erro de conexão:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[Worker:${nomeFila}] Job ${job.name} (ID: ${job.id}) concluído.`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker:${nomeFila}] Job ${job?.name} (ID: ${job?.id}) falhou:`, err);
  });

  workers.push(worker);
  console.log(`[Worker] Fila '${nomeFila}' com concorrência ${concurrency}.`);
}

console.log(
  `[ForenseDoc v3.0] Worker iniciado em ${NUCLEOS} núcleo(s). ${workers.length} filas ativas.`
);

// Vigia a saturação e avisa antes do cliente reclamar. Roda aqui, e não na API,
// porque a API pode ter várias instâncias e cada uma emitiria o mesmo alerta.
startQueueWatch();

// Falha de permissão no diretório de uploads degrada em silêncio para base64 no
// Redis. Conferir no start faz o problema aparecer como erro, não como consumo.
await ensureStorageReady();

// Usar o Nominatim público em produção é violação da política de uso dele, e o
// bloqueio chega por IP do servidor, sem aviso. Este processo é importado tanto
// pela API quanto pelo worker, então o alerta aparece nos dois.
avisarSeServicoPublico();

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
  // Elimina o PDF original vencido. Cumprimento da política de retenção: roda
  // todo dia porque um atraso aqui é dado pessoal guardado além do declarado.
  { name: "purge-uploads", pattern: "0 3 * * *", jobId: "cron-purge-uploads" },
  // Retenção das tabelas que crescem sem parar. Aos domingos: varre tabelas
  // inteiras e não precisa da frequência diária do expurgo de arquivos.
  { name: "purge-records", pattern: "30 3 * * 0", jobId: "cron-purge-records" },
];

for (const cron of CRONS) {
  cronsQueue
    .add(cron.name, {}, { repeat: { pattern: cron.pattern }, jobId: cron.jobId })
    .catch((err) => {
      console.error(`[Worker] Erro ao agendar cron '${cron.name}':`, err.message);
    });
}

/**
 * Encerramento ordenado.
 *
 * Sem isto, um deploy no meio de uma análise mata o processo com o job em
 * `active`: ele só volta para a fila quando o lock do BullMQ expira, e o
 * cliente fica olhando "processando" nesse intervalo. `worker.close()` espera os
 * jobs em andamento terminarem antes de sair.
 *
 * Passa a importar mais agora: com concorrência maior que 1, um deploy pega
 * vários jobs em andamento em vez de um.
 */
async function encerrar(sinal) {
  console.log(`[Worker] ${sinal} recebido. Aguardando jobs em andamento...`);
  await Promise.all(workers.map((w) => w.close()));
  console.log("[Worker] Encerrado.");
  process.exit(0);
}

process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));
