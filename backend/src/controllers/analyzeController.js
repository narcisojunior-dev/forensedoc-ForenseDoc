import crypto from "crypto";
import { prisma } from "../utils/prisma.js";
import { debitCredit, refundCredit, afterDebitCommit } from "../services/creditService.js";
import { saasQueue } from "../queues.js";
import { acquireLock, releaseLock, analysisLockKey } from "../utils/lock.js";
import { validatePdfPayload } from "../utils/pdfValidation.js";
import { buildReportPdf } from "../services/reportPdfService.js";
import { haversineKm } from "../utils/geoUtils.js";
import { parsePagination } from "../utils/pagination.js";

function hashFilename(filename) {
  return crypto.createHash("sha256").update(filename || "").digest("hex");
}

// Coordenada válida no Brasil (lat ~ -34..5, lon ~ -74..-34). Fora disso é
// erro de digitação — melhor ignorar que gravar um ponto absurdo.
function parseCoord(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -34 || la > 6 || lo < -74 || lo > -33) return null;
  return { lat: la, lon: lo };
}

// TTL do lock: teto de quanto uma análise pode demorar. Se o worker morrer
// no meio, o lock expira sozinho e o tenant não fica travado para sempre.
const ANALYSIS_LOCK_TTL = Math.ceil(Number(process.env.ANALYZE_TIMEOUT_MS || 90_000) / 1000) + 60;

export async function analyzePdf(req, res) {
  const { userId, tenantId } = req.auth;
  let lockToken = null;
  let analysis = null;

  try {
    const { pdfBase64, filename, homeAddress, homeLat, homeLon } = req.body || {};

    // Valida assinatura e tamanho ANTES de travar o tenant ou debitar crédito.
    const validation = validatePdfPayload(pdfBase64);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error, code: validation.code });
    }

    // Endereço residencial informado na tela — usado no confronto geográfico
    // do §5, com prioridade sobre o extraído do contrato. Opcional e limitado.
    const home = typeof homeAddress === "string" ? homeAddress.trim().slice(0, 300) : "";

    // Coordenada confirmada pelo operador (padrão-ouro): se informada e válida,
    // vence a geocodificação automática.
    const homeCoord = parseCoord(homeLat, homeLon);

    // Uma análise por vez por tenant (M4.4). O lock é liberado pelo worker
    // ao concluir o job — não aqui, que retorna 202 antes do processamento.
    lockToken = await acquireLock(analysisLockKey(tenantId), ANALYSIS_LOCK_TTL);
    if (!lockToken) {
      return res.status(409).json({
        error: "Já existe uma análise em andamento. Aguarde a conclusão para iniciar outra.",
        code: "ANALYSIS_IN_PROGRESS",
      });
    }

    const debit = await prisma.$transaction(async (tx) => {
      const created = await tx.analysis.create({
        data: {
          tenantId,
          userId,
          filenameHash: hashFilename(filename),
          status: "PROCESSING",
          processingStartedAt: new Date(),
        },
      });

      const { balanceBefore } = await debitCredit(tenantId, userId, created.id, tx);

      return { created, balanceBefore };
    });

    analysis = debit.created;

    // Cache e alerta só depois do commit: dentro da transação, um rollback
    // deixaria o cache invalidado e o alerta enviado por um débito desfeito.
    await afterDebitCommit(tenantId, debit.balanceBefore);

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
        homeCoord,
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

// Correção da coordenada da residência pelo operador (padrão-ouro forense).
// Recalcula as distâncias do §5 e re-persiste o resultado, para o laudo e o
// PDF refletirem o ponto confirmado por humano. Não custa crédito.
export async function correctAnalysisGeo(req, res) {
  try {
    const analysis = await prisma.analysis.findUnique({ where: { id: req.params.id } });
    if (!analysis || analysis.tenantId !== req.tenantId) {
      return res.status(404).json({ error: "Análise não encontrada." });
    }
    if (analysis.status !== "COMPLETED" || !analysis.result) {
      return res.status(409).json({ error: "Só é possível corrigir uma análise concluída." });
    }

    const coord = parseCoord(req.body?.lat, req.body?.lon);
    if (!coord) {
      return res.status(400).json({ error: "Coordenada inválida. Informe latitude e longitude dentro do Brasil." });
    }

    const result = { ...analysis.result };

    // Substitui a residência pela coordenada confirmada e recalcula distâncias.
    result.home = {
      query: result.home?.query || null,
      source: "Coordenada confirmada pelo operador",
      geo: {
        lat: coord.lat,
        lon: coord.lon,
        display: "Coordenada confirmada pelo operador",
        precision: "manual",
        source: "manual",
        cityMatch: true,
      },
    };

    if (result.contractGeo) {
      result.contractGeo.distance = haversineKm(coord.lat, coord.lon, result.contractGeo.lat, result.contractGeo.lon);
    }
    if (Array.isArray(result.ipAnalysis)) {
      result.ipAnalysis = result.ipAnalysis.map((ip) => ({
        ...ip,
        distance: ip.geo?.lat != null && ip.geo?.lon != null
          ? haversineKm(coord.lat, coord.lon, ip.geo.lat, ip.geo.lon)
          : null,
      }));
    }
    result.geoCorrectedAt = new Date().toISOString();

    await prisma.analysis.update({ where: { id: analysis.id }, data: { result } });

    await prisma.auditLog
      .create({
        data: {
          tenantId: req.tenantId,
          userId: req.auth.userId,
          action: "analysis_geo_corrected",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { analysisId: analysis.id, lat: coord.lat, lon: coord.lon },
        },
      })
      .catch(() => {});

    return res.json({ result });
  } catch (error) {
    console.error("[Analyze] Erro ao corrigir geolocalização:", error);
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

    const pdf = await buildReportPdf(analysis, analysis.result);
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
    const { page, limit, skip } = parsePagination(req.query);

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

/**
 * Contadores do dashboard (L4).
 *
 * Endpoint próprio em vez de reaproveitar o total da paginação de
 * `listAnalyses`: aquela rota carrega registros de análise só para descartar,
 * e o dashboard precisa de recortes que ela não faz (concluídas no mês, em
 * processamento). Aqui são três `count` — nenhuma linha sai do banco.
 *
 * Só conta `COMPLETED`: análise em `ERROR` ou `REFUNDED` não gerou laudo e não
 * pode inflar o número que o cliente vê.
 */
export async function getAnalysisStats(req, res) {
  try {
    const tenantId = req.tenantId; // do JWT, nunca do body

    const inicioDoMes = new Date();
    inicioDoMes.setDate(1);
    inicioDoMes.setHours(0, 0, 0, 0);

    const [completedTotal, completedThisMonth, processing] = await Promise.all([
      prisma.analysis.count({ where: { tenantId, status: "COMPLETED" } }),
      prisma.analysis.count({
        where: { tenantId, status: "COMPLETED", createdAt: { gte: inicioDoMes } },
      }),
      prisma.analysis.count({ where: { tenantId, status: "PROCESSING" } }),
    ]);

    return res.json({
      stats: { completedTotal, completedThisMonth, processing },
    });
  } catch (error) {
    console.error("[Analyze] Erro ao calcular estatísticas:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
