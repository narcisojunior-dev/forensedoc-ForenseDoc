import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 usa o engine "client" por padrão, que exige um driver adapter
// explícito (sem mais o binário de query engine em Rust).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

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
