import crypto from "node:crypto";
import { prisma } from "../utils/prisma.js";
import { refundCredit } from "../services/creditService.js";
import { notify } from "../services/notificationService.js";
import { releaseSlot, analysisLockKey } from "../utils/lock.js";
import { extractPdfTextWithOcr } from "../services/ocrService.js";
import { extractPdfMetadata } from "../services/pdfService.js";
import { enrichGeography } from "../services/geoEnrichmentService.js";
import { cleanPdfBase64 } from "../utils/stringUtils.js";
import { buildCustodyChain } from "../reports/custodyChain.js";
import { getPdf } from "../services/objectStorageService.js";
import { analisarDocumento } from "../engine/analisarDocumento.js";
import { buildSummaryForResult } from "../services/analysisRecompute.js";

function fileHashes(buffer) {
  return {
    sha256: crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase(),
    sha1: crypto.createHash("sha1").update(buffer).digest("hex").toUpperCase(),
  };
}

export async function processAnalysis(job) {
  const { analysisId, pdfKey, pdfBase64, tenantId, userId, lockToken, homeAddress, homeCoord, filename, creditoIsento } =
    job.data;

  try {
    /*
     * O PDF vem do armazenamento de objetos (caminho normal) ou do próprio
     * payload (compatibilidade: R2 não configurado, ou jobs enfileirados antes
     * desta mudança e ainda na fila no momento do deploy).
     */
    const pdfBuffer = pdfKey
      ? await getPdf(pdfKey)
      : Buffer.from(cleanPdfBase64(pdfBase64), "base64");

    // Hash do arquivo calculado sobre o que o SERVIDOR recebeu e analisou —
    // origem autoritativa da cadeia de custódia. Antes vinha do navegador.
    const hashes = fileHashes(pdfBuffer);

    const [extraction, metadata] = await Promise.all([
      extractPdfTextWithOcr(pdfBuffer),
      extractPdfMetadata(pdfBuffer),
    ]);

    /*
     * Motor pericial v2: extração por layout de banco, proveniência (PJe,
     * reimpressão), elegibilidade do documento, catálogo e validação das
     * assinaturas digitais, inventário de imagens e achados de irregularidade.
     * A regra mora em `engine/analisarDocumento.js`; aqui fica só a orquestração.
     */
    const analise = await analisarDocumento({
      pdfBuffer,
      extraction,
      rawMetadata: metadata,
    });
    const fallback = analise.extracted;

    // Confronto geográfico (§5). Depende de serviços externos instáveis
    // (Nominatim, ipapi.co), então roda em try/catch PRÓPRIO: se a geo falhar,
    // a análise continua COMPLETED com os campos geo vazios. Deixar a exceção
    // subir cairia no catch de baixo, que estorna o crédito e marca REFUNDED —
    // punindo o cliente por uma extração que deu certo.
    let geo = { home: null, contractGeo: null, geoDeclaredPresent: false, ipAnalysis: [] };
    try {
      geo = await enrichGeography(fallback, homeAddress, homeCoord);
    } catch (geoError) {
      console.error(`[AnalysisWorker] Enriquecimento geográfico falhou para ${analysisId}:`, geoError.message);
    }

    const generatedAt = new Date().toISOString();
    const result = {
      text: JSON.stringify(fallback),
      metadata: analise.metadata,
      eligibility: analise.eligibility,
      engine: { nome: "ForenseDoc motor pericial", versao: "2" },
      // Protocolo legível do laudo, derivado do conteúdo e da data: o mesmo que o
      // motor de geração imprimia no sumário executivo.
      reportId: `FD-${generatedAt.slice(0, 10).replace(/-/g, "")}-${hashes.sha256.slice(0, 10)}`,
      source: "local",
      usedOcr: extraction.usedOcr,
      ocrPages: extraction.ocrPages,
      ocrPageNumbers: extraction.ocrPageNumbers || [],
      ocrRefinementPages: extraction.ocrRefinementPages || [],
      warning: extraction.usedOcr
        ? `OCR aplicado automaticamente em ${extraction.ocrPages} página(s), incluindo o início e o final do documento${extraction.ocrRefinementPages?.length ? ", com releitura de alta precisão nas páginas finais da trilha" : ""}.`
        : "",
      // Artefatos forenses persistidos (Fase A) — laudo reprodutível.
      hashes,
      file: { name: filename || null, sizeBytes: pdfBuffer.length },
      home: geo.home,
      contractGeo: geo.contractGeo,
      geoDeclaredPresent: geo.geoDeclaredPresent,
      ipAnalysis: geo.ipAnalysis,
      // Cadeia de custódia já avaliada e persistida: o PDF do servidor e a tela
      // passam a ler a MESMA análise, em vez de cada um recalcular a sua. Era
      // por aí que as duas versões do § 4 divergiam.
      cadeiaCustodia: buildCustodyChain(fallback, geo.ipAnalysis, geo.geoDeclaredPresent),
      generatedAt,
    };
    result.sumarioIrregularidades = buildSummaryForResult(result, fallback);

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
      if (creditoIsento) {
        // Análise do administrador da plataforma: não houve débito a estornar.
        await prisma.analysis.update({ where: { id: analysisId }, data: { status: "ERROR" } });
      } else {
        // refundCredit já marca Analysis.status = "REFUNDED" como parte da sua
        // própria transação — só forçamos "ERROR" aqui se o estorno em si falhar,
        // pra não deixar a análise presa em "PROCESSING" para sempre.
        await refundCredit(tenantId, userId, analysisId, error.message);
      }
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
      body: creditoIsento
        ? "Não foi possível processar seu documento."
        : "Não foi possível processar seu documento. O crédito foi estornado automaticamente.",
      emailData: { reason: error.message },
    });
  } finally {
    // Devolve o slot do semáforo tanto no sucesso quanto na falha. Sem isto o
    // tenant perderia uma vaga até o TTL expirar, e num plano de vaga única isso
    // é o bloqueio total que o mutex antigo já causava.
    await releaseSlot(analysisLockKey(tenantId), lockToken);
  }
}
