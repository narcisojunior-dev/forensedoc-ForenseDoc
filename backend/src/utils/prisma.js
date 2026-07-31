import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * ─── Pool de conexões, dimensionado por processo ─────────────────────────────
 *
 * O adapter recebia só a connection string, então herdava o default do `pg`:
 * **10 conexões por processo**. Dois problemas, e o segundo só aparece depois de
 * escalar, que é o pior momento para descobrir.
 *
 * O worker pode querer mais que 10 ao mesmo tempo: com a concorrência da fase 1
 * são até 4 análises + 10 pagamentos + 5 e-mails em paralelo, cada um com suas
 * consultas. Requisições excedentes ficam na fila do pool até `connectionTimeout`
 * e então falham, e o erro (`timeout exceeded when trying to connect`) não sugere
 * em nada que a causa é dimensionamento.
 *
 * Do outro lado, o Postgres tem `max_connections` global, tipicamente 100. Cada
 * processo multiplica: réplicas de API mais réplicas de worker, vezes o tamanho
 * do pool. Depois que o `--scale` da fase 1 passou a ser possível, dez processos
 * com pool de 10 já encostam no teto, e aí o sintoma é a aplicação inteira
 * recusando conexão.
 *
 * Por isso o padrão difere por papel: o worker abre poucas conexões e as usa por
 * muito tempo (jobs longos), enquanto a API abre muitas e as devolve rápido.
 *
 * O papel é deduzido do processo em execução, e não só de `WORKER_MODE`. A
 * variável existe apenas no docker-compose, então qualquer outra forma de subir o
 * worker (process manager, `node src/worker.js` direto, Railway sem a variável)
 * cairia no dimensionamento da API e o subprovisionaria em silêncio: 15 conexões
 * para até 19 jobs simultâneos, com o excedente esperando no pool. A variável
 * continua valendo, para o caso de um entrypoint com outro nome.
 */
const EH_WORKER =
  process.env.WORKER_MODE === "true" || /worker\.js$/.test(process.argv[1] || "");

const POOL_MAX =
  Number(process.env.DB_POOL_MAX) ||
  // Worker: uma conexão por job simultâneo, com folga para os crons.
  (EH_WORKER
    ? Number(process.env.WORKER_CONCURRENCY_ANALYSIS || 4) +
      Number(process.env.WORKER_CONCURRENCY_PAYMENTS || 10) +
      Number(process.env.WORKER_CONCURRENCY_EMAILS || 5) +
      5
    : 15);

// Prisma 7 usa o engine "client" por padrão, que exige um driver adapter
// explícito (sem mais o binário de query engine em Rust).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  // Sem teto, uma consulta presa segura a conexão indefinidamente e o pool
  // esvazia sem nenhum erro aparecer.
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10_000,
  // Devolve conexões ociosas ao Postgres em vez de mantê-las reservadas: é o
  // que impede réplicas ociosas de consumirem o `max_connections` global.
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30_000,
});

console.log(
  `[Prisma] Pool com no máximo ${POOL_MAX} conexões (${EH_WORKER ? "worker" : "api"}).`
);

/**
 * O log de `query` fica DESLIGADO por padrão, inclusive em desenvolvimento
 * (N10 da auditoria).
 *
 * Ele despeja todo SQL executado no stdout — incluindo os INSERT/UPDATE da
 * tabela de usuários e dos tokens. Os valores vão como placeholders ($1, $2),
 * então não é vazamento direto de senha, mas é ruído que afoga os logs úteis e
 * expõe a estrutura inteira do banco a quem tiver acesso ao console.
 *
 * Ligue pontualmente com PRISMA_LOG_QUERIES=true quando estiver depurando uma
 * consulta específica.
 */
const logLevels =
  process.env.PRISMA_LOG_QUERIES === "true"
    ? ["query", "error", "warn"]
    : process.env.NODE_ENV === "development"
      ? ["error", "warn"]
      : ["error"];

export const prisma = new PrismaClient({ adapter, log: logLevels });
