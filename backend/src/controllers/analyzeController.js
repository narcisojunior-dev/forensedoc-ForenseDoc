import crypto from "crypto";
import { prisma } from "../utils/prisma.js";
import { debitCredit, refundCredit } from "../services/creditService.js";
import { saasQueue } from "../queues.js";
import { acquireLock, releaseLock, analysisLockKey } from "../utils/lock.js";
import { validatePdfPayload } from "../utils/pdfValidation.js";
import { buildReportPdf } from "../services/reportPdfService.js";

function hashFilename(filename) {
  return crypto.createHash("sha256").update(filename || "").digest("hex");
}

// TTL do lock: teto de quanto uma análise pode demorar. Se o worker morrer
// no meio, o lock expira sozinho e o tenant não fica travado para sempre.
const ANALYSIS_LOCK_TTL = Math.ceil(Number(process.env.ANALYZE_TIMEOUT_MS || 90_000) / 1000) + 60;

export async function analyzePdf(req, res) {
  const { userId, tenantId } = req.auth;
  let lockToken = null;
  let analysis = null;

  try {
    const { pdfBase64, filename, homeAddress } = req.body || {};

    // Valida assinatura e tamanho ANTES de travar o tenant ou debitar crédito.
    const validation = validatePdfPayload(pdfBase64);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, code: validation.code });
    }

    // Endereço residencial informado na tela — usado no confronto geográfico
    // do §5, com prioridade sobre o extraído do contrato. Opcional e limitado.
    const home = typeof homeAddress === "string" ? homeAddress.trim().slice(0, 300) : "";

    // Uma análise por vez por tenant (M4.4). O lock é liberado pelo worker
    // ao concluir o job — não aqui, que retorna 202 antes do processamento.
    lockToken = await acquireLock(analysisLockKey(tenantId), ANALYSIS_LOCK_TTL);
    if (!lockToken) {
      return res.status(409).json({
        error: "Já existe uma análise em andamento. Aguarde a conclusão para iniciar outra.",
        code: "ANALYSIS_IN_PROGRESS",
      });
    }

    analysis = await prisma.$transaction(async (tx) => {
      const created = await tx.analysis.create({
        data: {
          tenantId,
          userId,
          filenameHash: hashFilename(filename),
          status: "PROCESSING",
          processingStartedAt: new Date(),
        },
      });

      await debitCredit(tenantId, userId, created.id, tx);

      return created;
    });

    // Enfileira ANTES de responder: se a fila estiver fora do ar, o crédito
    // debitado precisa voltar em vez de deixar a análise presa em PROCESSING.
    await saasQueue.add(
      "process-pdf",
      {
        analysisId: analysis.id,
        pdfBase64: validation.base64,
        tenantId,
        userId,
        lockToken,
        homeAddress: home,
        filename: filename || null,
      },
      { attempts: 1, removeOnComplete: true, removeOnFail: true }
    );

    // Trilha de auditoria do evento (Seção 2.8). Nunca registra o conteúdo do
    // PDF — só o tamanho e o hash do nome do arquivo.
    await prisma.auditLog
      .create({
        data: {
          tenantId,
          userId,
          action: "analysis_started",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { analysisId: analysis.id, sizeBytes: validation.sizeBytes },
        },
      })
      .catch((err) => console.error("[Analyze] Falha ao registrar audit log:", err.message));

    return res.status(202).json({ analysisId: analysis.id, status: "PROCESSING" });
  } catch (error) {
    await releaseLock(analysisLockKey(tenantId), lockToken);

    if (error.message === "INSUFFICIENT_CREDITS") {
      return res.status(402).json({
        error: "Saldo de créditos insuficiente. Recarregue sua conta para continuar.",
        code: "INSUFFICIENT_CREDITS",
      });
    }

    // A análise já existia (e o crédito já saiu) quando a falha aconteceu:
    // estorna para o usuário não pagar por um laudo que nunca rodou.
    if (analysis) {
      await refundCredit(tenantId, userId, analysis.id, "Falha ao enfileirar a análise").catch(
        (refundError) => {
          console.error("[Analyze] Falha ao estornar crédito:", refundError.message);
        }
      );
    }

    console.error("[Analyze] Erro ao iniciar análise:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
}

export async function getAnalysisStatus(req, res) {
  try {
    const analysis = await prisma.analysis.findUnique({ where: { id: req.params.id } });
    if (!analysis || analysis.tenantId !== req.tenantId) {
      return res.status(404).json({ error: "Análise não encontrada." });
    }
    return res.json({ status: analysis.status, createdAt: analysis.createdAt });
  } catch (error) {
    console.error("[Analyze] Erro ao buscar status:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getAnalysisResult(req, res) {
  try {
    const analysis = await prisma.analysis.findUnique({ where: { id: req.params.id } });
    if (!analysis || analysis.tenantId !== req.tenantId) {
      return res.status(404).json({ error: "Análise não encontrada." });
    }
    if (analysis.status !== "COMPLETED") {
      return res.status(409).json({ error: "Análise ainda não concluída.", status: analysis.status });
    }
    return res.json({ status: analysis.status, result: analysis.result });
  } catch (error) {
    console.error("[Analyze] Erro ao buscar resultado:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// Laudo em PDF gerado no servidor (Fase B). On-demand, sem cache (M4.3).
export async function getAnalysisPdf(req, res) {
  try {
    const analysis = await prisma.analysis.findUnique({ where: { id: req.params.id } });
    if (!analysis || analysis.tenantId !== req.tenantId) {
      return res.status(404).json({ error: "Análise não encontrada." });
    }
    if (analysis.status !== "COMPLETED" || !analysis.result) {
      return res.status(409).json({ error: "Laudo indisponível: análise não concluída.", status: analysis.status });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="laudo-${analysis.id.slice(0, 8)}.pdf"`);

    const pdf = buildReportPdf(analysis, analysis.result);
    pdf.on("error", (err) => {
      console.error("[Analyze] Erro ao gerar PDF:", err.message);
      if (!res.headersSent) res.status(500).end();
    });
    pdf.pipe(res);
  } catch (error) {
    console.error("[Analyze] Erro ao gerar laudo PDF:", error);
    if (!res.headersSent) return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function listAnalyses(req, res) {
  try {
    const tenantId = req.tenantId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [analyses, total] = await Promise.all([
      prisma.analysis.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          filenameHash: true,
          createdAt: true,
          processingCompletedAt: true,
        },
      }),
      prisma.analysis.count({ where: { tenantId } }),
    ]);

    return res.json({
      analyses,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[Analyze] Erro ao listar análises:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
