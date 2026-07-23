/**
 * Cria (ou converte) uma conta de assinante para teste manual.
 *
 * Assinar pelo fluxo real exige a API da Asaas, indisponível em
 * desenvolvimento. Este script monta o mesmo estado final que o webhook de
 * PAYMENT_RECEIVED produziria: assinatura ACTIVE, ciclo aberto e créditos
 * mensais carregados.
 *
 * Uso:
 *   node scripts/make-subscriber.js                          # padrão: profissional
 *   node scripts/make-subscriber.js assinante@teste.com fundador
 *   node scripts/make-subscriber.js assinante@teste.com massa --senha Outra1234
 *
 * Planos: inicial | profissional | escritorio | massa | fundador
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/utils/prisma.js";
import "dotenv/config";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const email = args[0] || "assinante@forensedoc.test";
const planSlug = args[1] || "profissional";

const senhaIdx = process.argv.indexOf("--senha");
const password = senhaIdx > -1 ? process.argv[senhaIdx + 1] : "Teste1234";

// CPF fictício estável por e-mail, para reexecuções não colidirem entre si.
function fakeCpf(seed) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 100000000000;
  return String(hash).padStart(11, "0");
}

try {
  const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
  if (!plan) {
    console.error(`✗ Plano "${planSlug}" não encontrado. Rode: node prisma/seed.js`);
    console.error("  Disponíveis: inicial, profissional, escritorio, massa, fundador");
    process.exit(1);
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  let user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });

  if (!user) {
    const passwordHash = await bcrypt.hash(password, 12);
    const tenant = await prisma.tenant.create({
      data: {
        name: "Escritório de Teste",
        cpfCnpj: fakeCpf(email),
        oabNumber: "54321",
        oabState: "PI",
        status: "ACTIVE",
      },
    });
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Assinante de Teste",
        email,
        passwordHash,
        role: "OWNER",
        oabNumber: "54321",
        emailVerified: true,
      },
      include: { tenant: true },
    });
    console.log(`✓ Conta criada: ${email}`);
  } else {
    await prisma.tenant.update({ where: { id: user.tenantId }, data: { status: "ACTIVE" } });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    console.log(`✓ Conta existente reaproveitada: ${email}`);
  }

  const tenantId = user.tenantId;

  // Assinatura ativa no ciclo corrente.
  await prisma.subscription.upsert({
    where: { tenantId },
    update: {
      planId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    create: {
      tenantId,
      planId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      founderLocked: plan.isFounder,
      founderLockedUntil: plan.isFounder
        ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
        : null,
    },
  });

  // Saldo do ciclo, como o webhook de pagamento confirmado faria.
  await prisma.creditBalance.upsert({
    where: { tenantId },
    update: {
      creditsMonthly: plan.creditsMonthly,
      cycleStart: now,
      cycleEnd: periodEnd,
    },
    create: {
      tenantId,
      creditsMonthly: plan.creditsMonthly,
      cycleStart: now,
      cycleEnd: periodEnd,
    },
  });

  await prisma.creditTransaction.create({
    data: {
      tenantId,
      userId: user.id,
      type: "EARN_MONTHLY",
      amount: plan.creditsMonthly,
      creditType: "monthly",
      source: "subscription_renewal",
      notes: "Assinatura criada via script de teste",
    },
  });

  console.log(`  Plano.......: ${plan.name} (R$ ${Number(plan.priceBrl).toFixed(2)}/mês)`);
  console.log(`  Créditos....: ${plan.creditsMonthly} mensais`);
  console.log(`  Ciclo até...: ${periodEnd.toLocaleDateString("pt-BR")}`);
  console.log(`  Limite users: ${plan.maxUsers}`);
  console.log("");
  console.log(`  Login: ${email} / ${password}`);
} catch (err) {
  console.error("✗ Falha:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
