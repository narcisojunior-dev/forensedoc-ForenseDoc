/**
 * Aplica as migrations do Prisma no deploy.
 *
 * O banco de produção foi criado com `prisma db push` (sem histórico de
 * migrations). Rodar `migrate deploy` direto nele falharia: a migration
 * `0_init` tentaria criar tabelas que já existem (P3005).
 *
 * Este script faz o "baseline" oficial do Prisma antes do deploy:
 *   - banco vazio            → migrate deploy cria tudo do zero
 *   - banco já com o schema  → marca 0_init como aplicada e segue em frente
 *   - banco já com migrations→ nada a fazer, só migrate deploy
 *
 * É idempotente: pode rodar em todo boot sem efeito colateral.
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import "dotenv/config";

const BASELINE_MIGRATION = "0_init";

// Tabela usada para detectar um schema pré-existente criado via `db push`.
// Qualquer tabela do schema serviria; `tenants` é a raiz do modelo.
const SENTINEL_TABLE = "tenants";

function run(args) {
  execFileSync("npx", ["prisma", ...args], { stdio: "inherit" });
}

async function inspectDatabase() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT to_regclass('public._prisma_migrations') AS migrations, to_regclass($1) AS sentinel",
      [`public.${SENTINEL_TABLE}`]
    );
    return {
      hasMigrationHistory: rows[0].migrations !== null,
      hasExistingSchema: rows[0].sentinel !== null,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[db-deploy] DATABASE_URL não definida.");
    process.exit(1);
  }

  const { hasMigrationHistory, hasExistingSchema } = await inspectDatabase();

  if (!hasMigrationHistory && hasExistingSchema) {
    console.log(
      `[db-deploy] Banco pré-existente detectado (criado via db push). ` +
        `Marcando "${BASELINE_MIGRATION}" como aplicada (baseline).`
    );
    run(["migrate", "resolve", "--applied", BASELINE_MIGRATION]);
  }

  console.log("[db-deploy] Aplicando migrations pendentes...");
  run(["migrate", "deploy"]);
  console.log("[db-deploy] Migrations aplicadas com sucesso.");
}

main().catch((err) => {
  console.error("[db-deploy] Falha ao aplicar migrations:", err.message);
  process.exit(1);
});
