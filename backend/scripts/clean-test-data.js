/**
 * Remove contas de teste do banco de desenvolvimento.
 *
 * O smoke test cria uma conta a cada execução, e os testes manuais deixam
 * outras pelo caminho. Este script apaga apenas o que casa com os padrões
 * abaixo — nunca uma conta real.
 *
 * Uso:
 *   node scripts/clean-test-data.js            # mostra o que seria apagado
 *   node scripts/clean-test-data.js --apply    # apaga de verdade
 *   node scripts/clean-test-data.js --apply --tudo   # inclui as contas fixas
 *
 * Por segurança, recusa rodar com NODE_ENV=production.
 */
import { prisma } from "../src/utils/prisma.js";
import "dotenv/config";

const apply = process.argv.includes("--apply");
const tudo = process.argv.includes("--tudo");

if (process.env.NODE_ENV === "production") {
  console.error("✗ Recusando rodar com NODE_ENV=production.");
  process.exit(1);
}

// Contas descartáveis, geradas por scripts e testes.
const DESCARTAVEIS = [
  { email: { startsWith: "smoke+" } },
  { email: { startsWith: "debug" } },
  { email: { startsWith: "repro+" } },
  { email: { startsWith: "membro" } },
  { email: { startsWith: "chefe" } }, // chefe@, chefe2@, ...
  // Membros de teste nomeados m1@…m9@ (convidados nos cenários de equipe).
  ...Array.from({ length: 9 }, (_, i) => ({ email: `m${i + 1}@forensedoc.test` })),
];

// Contas fixas usadas para teste manual — só saem com --tudo.
const FIXAS = [
  { email: "admin@forensedoc.test" },
  { email: "assinante@forensedoc.test" },
  { email: "fundador@forensedoc.test" },
];

try {
  const where = { OR: tudo ? [...DESCARTAVEIS, ...FIXAS] : DESCARTAVEIS };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, tenantId: true },
  });

  if (users.length === 0) {
    console.log("Nada para limpar.");
    process.exit(0);
  }

  // Apagar o tenant leva junto usuários, saldos, análises e notificações
  // (onDelete: Cascade no schema).
  const tenantIds = [...new Set(users.map((u) => u.tenantId))];

  console.log(`${users.length} usuário(s) em ${tenantIds.length} escritório(s):`);
  for (const u of users) console.log(`  - ${u.email}`);

  if (!apply) {
    console.log("\nNada foi apagado. Rode com --apply para confirmar.");
    process.exit(0);
  }

  // AuditLog e CreditTransaction referenciam usuário sem cascade — soltar
  // as referências antes de remover o tenant.
  await prisma.auditLog.updateMany({
    where: { tenantId: { in: tenantIds } },
    data: { userId: null },
  });
  await prisma.creditTransaction.updateMany({
    where: { tenantId: { in: tenantIds } },
    data: { userId: null },
  });

  // FounderInvite guarda tenantId sem relação declarada — devolver o convite
  // ao estado disponível em vez de deixar apontando para um tenant morto.
  const invitesLiberados = await prisma.founderInvite.updateMany({
    where: { tenantId: { in: tenantIds } },
    data: { tenantId: null, usedAt: null },
  });

  const { count } = await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  console.log(`\n✓ ${count} escritório(s) removido(s).`);
  if (invitesLiberados.count > 0) {
    console.log(`✓ ${invitesLiberados.count} convite(s) de fundador liberado(s) novamente.`);
  }
} catch (err) {
  console.error("✗ Falha:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
