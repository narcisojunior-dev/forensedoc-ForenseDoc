import { prisma } from "../utils/prisma.js";
import { refundCredit } from "../services/creditService.js";
import { extractPdfTextWithOcr } from "../services/ocrService.js";
import { extractPdfMetadata } from "../services/pdfService.js";
import { heuristicExtractionFromText } from "../services/extractionService.js";
import { cleanPdfBase64, stripDiacritics } from "../utils/stringUtils.js";

export async function processAnalysis(job) {
  const { analysisId, pdfBase64, tenantId, userId } = job.data;

  try {
    const pdfBuffer = Buffer.from(cleanPdfBase64(pdfBase64), "base64");
    const [extraction, metadata] = await Promise.all([
      extractPdfTextWithOcr(pdfBuffer),
      extractPdfMetadata(pdfBuffer),
    ]);

    const fallback = heuristicExtractionFromText(extraction.text);
    const metadataAuthor = stripDiacritics(metadata.author || "").toLowerCase();
    const clientName = stripDiacritics(fallback.cliente?.nome || "").toLowerCase();

    if (metadataAuthor && clientName && !clientName.includes(metadataAuthor) && !metadataAuthor.includes(clientName)) {
      metadata.warnings.push(`O autor declarado nos metadados (${metadata.author}) difere do nome do contratante extraído (${fallback.cliente.nome}). A divergência não comprova fraude, mas deve ser contextualizada.`);
    }

    const result = {
      text: JSON.stringify(fallback),
      metadata,
      source: "local",
      usedOcr: extraction.usedOcr,
      ocrPages: extraction.ocrPages,
      warning: extraction.usedOcr
        ? `OCR aplicado automaticamente em ${extraction.ocrPages} página(s) antes da análise local.`
        : "",
    };

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: "COMPLETED", result, processingCompletedAt: new Date() },
    });
  } catch (error) {
    console.error(`[AnalysisWorker] Falha ao processar análise ${analysisId}:`, error);

    try {
      // refundCredit já marca Analysis.status = "REFUNDED" como parte da sua
      // própria transação — só forçamos "ERROR" aqui se o estorno em si falhar,
      // pra não deixar a análise presa em "PROCESSING" para sempre.
      await refundCredit(tenantId, userId, analysisId, error.message);
    } catch (refundError) {
      console.error(`[AnalysisWorker] Falha ao estornar crédito da análise ${analysisId}:`, refundError.message);
      await prisma.analysis
        .update({ where: { id: analysisId }, data: { status: "ERROR" } })
        .catch(() => {});
    }
  }
}
