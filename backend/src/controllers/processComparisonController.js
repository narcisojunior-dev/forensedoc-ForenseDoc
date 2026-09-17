import crypto from "node:crypto";
import { prisma } from "../utils/prisma.js";
import { analysisQueue } from "../queues.js";
import { acquireSlot, releaseSlot, analysisLockKey, SLOT_COTA_DO_USUARIO } from "../utils/lock.js";
import { getPlanLimits } from "../services/planLimitsService.js";
import { ocrBudgetMs } from "../services/ocrService.js";
import { validatePdfPayload } from "../utils/pdfValidation.js";
import { putPdf, buildKey, deletePdf } from "../services/objectStorageService.js";

/**
 * Confronto do contrato periciado com o PDF do processo judicial (motor
 * pericial v2).
 *
 * ─── Por que é uma rota à parte, e não um campo a mais em /analyze ───────────
 *
 * O confronto só faz sentido depois que o contrato foi lido: ele procura no
 * processo os valores, datas e identificadores que a extração encontrou (e que
 * o operador pode ter corrigido na revisão). Enviar os dois PDFs juntos também
 * dobraria o teto de corpo da rota de análise.
 *
 * ─── Custo ───────────────────────────────────────────────────────────────────
 *
 * É complemento de um laudo já pago: não debita crédito. Ocupa, porém, uma vaga
 * do semáforo de análises do plano, porque o PDF do processo costuma ser
 * escaneado e o OCR disputa a mesma CPU.
 */

const SLOT_TTL = Math.ceil(ocrBudgetMs() / 1000) + 120;

export async function startProcessComparison(req, res) {
  const { userId, tenantId } = req.auth;
  let lockToken = null;
  let pdfKey = null;

  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id: req.params.id },
      select: { id: true, tenantId: true, status: true, result: true },
    });
    if (!analysis || analysis.tenantId !== tenantId) {
      return res.status(404).json({ error: "Análise não encontrada." });
    }
    if (analysis.status !== "COMPLETED" || !analysis.result) {
      return res.status(409).json({ error: "O confronto exige uma análise concluída." });
    }
    if (analysis.result.processComparison?.status === "PROCESSING") {
      return res.status(409).json({
        error: "Já existe um confronto com o processo em andamento para esta análise.",
        code: "PROCESS_COMPARISON_IN_PROGRESS",
      });
    }

    const { pdfBase64, filename } = req.body || {};
    const validation = validatePdfPayload(pdfBase64);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, code: validation.code });
    }

    const { maxConcurrentAnalyses } = await getPlanLimits(tenantId);
    const slot = await acquireSlot(analysisLockKey(tenantId), maxConcurrentAnalyses, SLOT_TTL, userId);
    lockToken = slot.token;
    if (!lockToken) {
      return res.status(409).json({
        error:
          slot.motivo === SLOT_COTA_DO_USUARIO
            ? "Você atingiu sua parte das análises simultâneas da equipe. Aguarde a conclusão de uma das suas."
            : "As análises simultâneas do seu plano estão em uso. Aguarde a conclusão de uma delas.",
        code: slot.motivo === SLOT_COTA_DO_USUARIO ? "ANALYSIS_USER_QUOTA" : "ANALYSIS_IN_PROGRESS",
      });
    }

    const buffer = Buffer.from(validation.base64, "base64");
    // O PDF do processo só existe durante o job: o worker o apaga ao terminar,
    // com sucesso ou falha. O confronto persiste o hash, não o arquivo.
    pdfKey = await putPdf(buildKey(tenantId, `${analysis.id}-processo`), buffer);

    const nome = typeof filename === "string" ? filename.slice(0, 200) : null;
    await prisma.analysis.update({
      where: { id: analysis.id },
      data: {
        result: {
          ...analysis.result,
          processComparison: {
            status: "PROCESSING",
            startedAt: new Date().toISOString(),
            file: { name: nome, sizeBytes: validation.sizeBytes },
          },
        },
      },
    });

    await analysisQueue.add(
      "compare-process",
      {
        analysisId: analysis.id,
        tenantId,
        userId,
        lockToken,
        filename: nome,
        pdfKey: pdfKey || undefined,
        pdfBase64: pdfKey ? undefined : validation.base64,
      },
      { attempts: 1, removeOnComplete: true, removeOnFail: true }
    );

    await prisma.auditLog
      .create({
        data: {
          tenantId,
          userId,
          action: "process_comparison_started",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: {
            analysisId: analysis.id,
            sizeBytes: validation.sizeBytes,
            filenameHash: crypto.createHash("sha256").update(nome || "").digest("hex"),
          },
        },
      })
      .catch((err) => console.error("[ProcessComparison] Falha ao registrar audit log:", err.message));

    return res.status(202).json({ analysisId: analysis.id, status: "PROCESSING" });
  } catch (error) {
    await releaseSlot(analysisLockKey(tenantId), lockToken);
    if (pdfKey) await deletePdf(pdfKey);
    console.error("[ProcessComparison] Erro ao iniciar confronto:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
}
