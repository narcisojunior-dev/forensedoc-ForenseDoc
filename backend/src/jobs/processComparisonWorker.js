import crypto from "node:crypto";
import { prisma } from "../utils/prisma.js";
import { releaseSlot, analysisLockKey } from "../utils/lock.js";
import { extractPdfTextWithOcr } from "../services/ocrService.js";
import { extractPdfMetadata } from "../services/pdfService.js";
import { getPdf, deletePdf } from "../services/objectStorageService.js";
import { compareProcessWithContract } from "../engine/processComparison.js";
import { cleanPdfBase64 } from "../utils/stringUtils.js";

/** O extraído é persistido como texto JSON dentro do resultado. */
function lerExtraido(result) {
  try {
    return JSON.parse(String(result?.text || "{}"));
  } catch {
    return {};
  }
}

/**
 * Grava o confronto no resultado MAIS RECENTE da análise.
 *
 * O job leva minutos com OCR, e nesse intervalo o operador pode ter revisado
 * campos ou corrigido a coordenada. Regravar o resultado lido no início
 * apagaria essas correções.
 */
async function gravarConfronto(analysisId, processComparison) {
  const atual = await prisma.analysis.findUnique({ where: { id: analysisId }, select: { result: true } });
  if (!atual?.result) return;
  await prisma.analysis.update({
    where: { id: analysisId },
    data: { result: { ...atual.result, processComparison } },
  });
}

export async function processProcessComparison(job) {
  const { analysisId, tenantId, lockToken, filename, pdfKey, pdfBase64 } = job.data;

  try {
    const buffer = pdfKey ? await getPdf(pdfKey) : Buffer.from(cleanPdfBase64(pdfBase64), "base64");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();

    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId }, select: { result: true } });
    const extraido = lerExtraido(analysis?.result);

    const [leitura, metadata] = await Promise.all([
      extractPdfTextWithOcr(buffer),
      extractPdfMetadata(buffer),
    ]);
    // `status` do confronto é o veredito textual ("DIVERGÊNCIAS A CONFERIR");
    // no resultado persistido `status` é o estado do job. Não podem colidir.
    const { status: resultado, ...comparison } = compareProcessWithContract(leitura.text, extraido);

    await gravarConfronto(analysisId, {
      ...comparison,
      status: "COMPLETED",
      resultado,
      // Última revisão de campos considerada. Revisão posterior não entra no
      // confronto; a tela compara as datas e avisa quando for preciso refazer.
      camposRevisadosAte:
        Object.values(analysis?.result?.camposRevisados || {})
          .map((campo) => campo?.em)
          .filter(Boolean)
          .sort()
          .at(-1) || null,
      file: {
        name: filename || null,
        sizeBytes: buffer.length,
        sizeKB: (buffer.length / 1024).toFixed(2),
        sha256,
      },
      // Só o necessário ao laudo: o objeto completo de metadados do processo
      // inflaria o resultado sem acrescentar ao confronto.
      metadata: {
        totalPages: metadata.totalPages ?? null,
        producer: metadata.producer ?? null,
        creationDate: metadata.creationDate ?? null,
      },
      usedOcr: Boolean(leitura.usedOcr),
      ocrPages: leitura.ocrPages || 0,
      warning: leitura.usedOcr
        ? `OCR aplicado automaticamente em ${leitura.ocrPages} página(s) do processo.`
        : "",
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[ProcessComparison] Falha no confronto da análise ${analysisId}:`, error);
    await gravarConfronto(analysisId, {
      status: "ERROR",
      error: "Não foi possível ler o PDF do processo. Verifique o arquivo e tente novamente.",
      file: { name: filename || null },
      completedAt: new Date().toISOString(),
    }).catch((err) => console.error("[ProcessComparison] Falha ao registrar erro:", err.message));
  } finally {
    if (pdfKey) await deletePdf(pdfKey);
    await releaseSlot(analysisLockKey(tenantId), lockToken);
  }
}
