import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Planos da Tabela 3.2 do PRD v3.0. O avulso não é linha de Plan — é a rota
// /billing/avulso, a R$ 79 para quem não assina.
//
// `avulsoPriceBrl` é o preço do mesmo laudo avulso para quem JÁ assina o plano,
// limitado a `avulsoDiscountLimit` compras por ciclo. O gradiente é proposital:
// quanto melhor o plano, mais barato o avulso, para que subir de plano continue
// valendo mais a pena do que acumular avulsos. Todos os valores ficam acima do
// custo por laudo do próprio plano (Inicial R$13,13 · Profissional R$7,43 ·
// Escritório R$4,98 · Massa R$3,98), senão o avulso canibalizaria o upgrade.
//
// Valores iniciais — ajustáveis pelo admin em PATCH /admin/plans/:id sem deploy.
const plans = [
  {
    name: "Inicial",
    slug: "inicial",
    priceBrl: 197.0,
    creditsMonthly: 15,
    maxUsers: 1,
    avulsoPriceBrl: 49.0,
    avulsoDiscountLimit: 1,
  },
  {
    name: "Profissional",
    slug: "profissional",
    priceBrl: 297.0,
    creditsMonthly: 40,
    maxUsers: 1,
    avulsoPriceBrl: 39.0,
    avulsoDiscountLimit: 1,
  },
  {
    name: "Escritório",
    slug: "escritorio",
    priceBrl: 597.0,
    creditsMonthly: 120,
    maxUsers: 3,
    avulsoPriceBrl: 29.0,
    avulsoDiscountLimit: 1,
  },
  {
    name: "Massa / Operação",
    slug: "massa",
    priceBrl: 1990.0,
    creditsMonthly: 500,
    maxUsers: 5,
    avulsoPriceBrl: 19.0,
    avulsoDiscountLimit: 1,
  },
  {
    name: "Fundador",
    slug: "fundador",
    priceBrl: 197.0,
    creditsMonthly: 40,
    maxUsers: 1,
    // Mesmo avulso do Profissional: o benefício de fundador já está na
    // mensalidade travada, não se acumula aqui.
    avulsoPriceBrl: 39.0,
    avulsoDiscountLimit: 1,
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
