import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Planos da Tabela 3.2 do PRD v3.0. Avulso (R$79) e Excedente (R$7,90) não são
// linhas de Plan — avulso é a rota /billing/avulso, excedente é o campo
// excessPriceBrl de cada plano.
const plans = [
  {
    name: "Inicial",
    slug: "inicial",
    priceBrl: 197.0,
    creditsMonthly: 15,
    maxUsers: 1,
    excessPriceBrl: 7.9,
  },
  {
    name: "Profissional",
    slug: "profissional",
    priceBrl: 297.0,
    creditsMonthly: 40,
    maxUsers: 1,
    excessPriceBrl: 7.9,
  },
  {
    name: "Escritório",
    slug: "escritorio",
    priceBrl: 597.0,
    creditsMonthly: 120,
    maxUsers: 3,
    excessPriceBrl: 7.9,
  },
  {
    name: "Massa / Operação",
    slug: "massa",
    priceBrl: 1990.0,
    creditsMonthly: 500,
    maxUsers: 5,
    excessPriceBrl: 7.9,
  },
  {
    name: "Fundador",
    slug: "fundador",
    priceBrl: 197.0,
    creditsMonthly: 40,
    maxUsers: 1,
    excessPriceBrl: 7.9,
    isFounder: true,
    founderSlotsTotal: 25,
    founderSlotsRemaining: 25,
  },
];

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
    console.log(`[Seed] Plano "${plan.name}" (${plan.slug}) ok.`);
  }
}

main()
  .then(() => {
    console.log("[Seed] Planos seedados com sucesso.");
    return prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("[Seed] Erro ao seedar planos:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
