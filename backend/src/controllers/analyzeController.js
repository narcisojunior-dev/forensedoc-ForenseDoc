import crypto from "crypto";
import { prisma } from "../utils/prisma.js";
import { debitCredit } from "../services/creditService.js";
import { saasQueue } from "../queues.js";

function hashFilename(filename) {
  return crypto.createHash("sha256").update(filename || "").digest("hex");
}

export async function analyzePdf(req, res) {
  try {
    const { pdfBase64, filename } = req.body || {};
    if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 ausente." });

    const { userId, tenantId } = req.auth;

    const analysis = await prisma.$transaction(async (tx) => {
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

    res.status(202).json({ analysisId: analysis.id, status: "PROCESSING" });

    await saasQueue
      .add(
        "process-pdf",
        { analysisId: analysis.id, pdfBase64, tenantId, userId },
        { attempts: 1, removeOnComplete: true, removeOnFail: true }
      )
      .catch((err) => {
        console.error("[Analyze] Erro ao enfileirar job de análise:", err.message);
      });
  } catch (error) {
    if (error.message === "INSUFFICIENT_CREDITS") {
      return res.status(402).json({
        error: "Saldo de créditos insuficiente. Recarregue sua conta para continuar.",
        code: "INSUFFICIENT_CREDITS",
      });
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
