import "dotenv/config";
import { prisma } from "../src/utils/prisma.js";
import { emitirVerificacao } from "../src/services/verificacaoStore.js";

/**
 * Cria o registro de verificação dos laudos emitidos antes desta funcionalidade.
 *
 * Sem isso, todo laudo anterior ao deploy responde "não encontrado" na página
 * pública, e o cliente que baixar de novo um laudo antigo recebe um PDF sem QR.
 *
 * É idempotente de propósito: a rotina vai ser rodada mais de uma vez, porque a
 * primeira execução em produção costuma ser interrompida por timeout de
 * conexão no meio da base.
 *
 * Uso:
 *   node scripts/backfill-verificacoes.js --seco     # só conta, não escreve
 *   node scripts/backfill-verificacoes.js
 */

export async function backfillVerificacoes({ lote = 200, seco = false } = {}) {
  const resumo = { criadas: 0, puladas: 0, falhas: 0 };

  const analises = await prisma.analysis.findMany({
    where: { status: "COMPLETED", result: { not: null } },
    select: { id: true, tenantId: true, result: true },
    orderBy: { createdAt: "asc" },
    take: lote,
  });

  for (const analise of analises) {
    try {
      const existente = await prisma.laudoVerification.findFirst({ where: { analysisId: analise.id } });
      if (existente) {
        resumo.puladas++;
        continue;
      }
      if (!analise.result) throw new Error("análise COMPLETED sem result");

      if (!seco) {
        await emitirVerificacao({ analysisId: analise.id, tenantId: analise.tenantId, result: analise.result });
      }
      resumo.criadas++;
    } catch (erro) {
      resumo.falhas++;
      console.error(`[Backfill] ${analise.id}: ${erro.message}`);
    }
  }

  return resumo;
}

// Só executa quando chamado direto, para o teste poder importar sem disparar.
if (process.argv[1]?.endsWith("backfill-verificacoes.js")) {
  const seco = process.argv.includes("--seco");
  const resumo = await backfillVerificacoes({ lote: 100000, seco });
  console.log(`[Backfill] criadas: ${resumo.criadas}, puladas: ${resumo.puladas}, falhas: ${resumo.falhas}`);
  if (seco) console.log("[Backfill] modo seco: nada foi gravado.");
  await prisma.$disconnect();
}
