/**
 * Lista análises concluídas cujos laudos podem conter os defeitos corrigidos na
 * homologação do dossiê C6 (data do tribunal como data do contrato, CET no teto
 * de 20%, composição sem seguro, referência residencial de outra UF etc.).
 *
 * SOMENTE LEITURA. Não altera análises, não reprocessa e não notifica ninguém:
 * produz um relatório para decisão humana. A saída não traz nome, CPF nem
 * endereço, só identificadores internos e os critérios atingidos.
 *
 * Uso:
 *   node scripts/varrerLaudosAfetados.js
 *   node scripts/varrerLaudosAfetados.js --desde=2026-09-01 --tenant=<id> --saida=afetados.json
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { prisma } from "../src/utils/prisma.js";
import { avaliarAnaliseAfetada, CRITERIOS_VARREDURA } from "../src/services/varreduraLaudos.js";

const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=") || null;
const desde = arg("desde");
const tenant = arg("tenant");
const saida = arg("saida");
const LOTE = 200;

const where = {
  status: "COMPLETED",
  ...(tenant ? { tenantId: tenant } : {}),
  ...(desde ? { createdAt: { gte: new Date(`${desde}T00:00:00Z`) } } : {}),
};

const afetadas = [];
const contagem = Object.fromEntries(CRITERIOS_VARREDURA.map((c) => [c.id, 0]));
let examinadas = 0;
let cursor = null;

try {
  for (;;) {
    const lote = await prisma.analysis.findMany({
      where,
      select: { id: true, tenantId: true, createdAt: true, result: true },
      orderBy: { id: "asc" },
      take: LOTE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!lote.length) break;
    for (const analise of lote) {
      examinadas += 1;
      const criterios = avaliarAnaliseAfetada(analise.result);
      if (!criterios.length) continue;
      for (const c of criterios) contagem[c.id] += 1;
      afetadas.push({
        analysisId: analise.id,
        tenantId: analise.tenantId,
        criadaEm: analise.createdAt.toISOString(),
        reportId: analise.result?.reportId || null,
        criterios: criterios.map((c) => c.id),
        gravidadeMaxima: criterios.some((c) => c.gravidade === "ALTA") ? "ALTA" : "MÉDIA",
      });
    }
    cursor = lote.at(-1).id;
  }

  const relatorio = { geradoEm: new Date().toISOString(), filtros: { desde, tenant }, examinadas, afetadas: afetadas.length, porCriterio: contagem, criterios: CRITERIOS_VARREDURA, analises: afetadas };
  if (saida) {
    await writeFile(saida, JSON.stringify(relatorio, null, 2));
    console.log(`Relatório gravado em ${saida}.`);
  }
  console.log(`Análises examinadas: ${examinadas}. Possivelmente afetadas: ${afetadas.length}.`);
  for (const c of CRITERIOS_VARREDURA) console.log(`  ${String(contagem[c.id]).padStart(5)}  ${c.gravidade.padEnd(5)}  ${c.id}: ${c.descricao}`);
} finally {
  await prisma.$disconnect();
}
