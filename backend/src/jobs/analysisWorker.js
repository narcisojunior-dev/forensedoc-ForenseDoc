import { prisma } from "../utils/prisma.js";
import { refundCredit } from "../services/creditService.js";
import { notify } from "../services/notificationService.js";
import { releaseLock, analysisLockKey } from "../utils/lock.js";
import { extractPdfTextWithOcr } from "../services/ocrService.js";
import { extractPdfMetadata } from "../services/pdfService.js";
import { heuristicExtractionFromText } from "../services/extractionService.js";
import { cleanPdfBase64, stripDiacritics } from "../utils/stringUtils.js";

export async function processAnalysis(job) {
  const { analysisId, pdfBase64, tenantId, userId, lockToken } = job.data;

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

    // Só in-app: o usuário está olhando a tela fazendo polling, um e-mail a
    // cada laudo concluído seria ruído.
    await notify({
      tenantId,
      userId,
      type: "ANALYSIS_COMPLETED",
      title: "Laudo concluído",
      body: "Sua análise foi processada e o laudo está disponível no histórico.",
      email: false,
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

    await notify({
      tenantId,
      userId,
      type: "ANALYSIS_ERROR",
      title: "Falha na análise",
      body: "Não foi possível processar seu documento. O crédito foi estornado automaticamente.",
      emailData: { reason: error.message },
    });
  } finally {
    // Libera o mutex de "uma análise por vez" tanto no sucesso quanto na
    // falha — sem isso o tenant ficaria bloqueado até o TTL do lock expirar.
    await releaseLock(analysisLockKey(tenantId), lockToken);
  }
}
