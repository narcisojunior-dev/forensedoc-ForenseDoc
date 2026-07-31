import crypto from "crypto";
import { prisma } from "../utils/prisma.js";
import { debitCredit, refundCredit, afterDebitCommit } from "../services/creditService.js";
import { analysisQueue } from "../queues.js";
import {
  acquireSlot,
  releaseSlot,
  analysisLockKey,
  SLOT_COTA_DO_USUARIO,
} from "../utils/lock.js";
import { getPlanLimits } from "../services/planLimitsService.js";
import { ocrBudgetMs } from "../services/ocrService.js";
import { validatePdfPayload } from "../utils/pdfValidation.js";
import { buildReportPdf } from "../services/reportPdfService.js";
import { haversineKm } from "../utils/geoUtils.js";
import { parsePagination } from "../utils/pagination.js";
import { redis } from "../utils/redis.js";
import { putPdf, buildKey, deletePdf } from "../services/objectStorageService.js";

function hashFilename(filename) {
  return crypto.createHash("sha256").update(filename || "").digest("hex");
}

/*
 * ─── Anti-duplo-clique por CONTEÚDO, não por relógio ─────────────────────────
 *
 * A janela fixa de 30 segundos entre análises existia para impedir que o usuário
 * reenviasse o mesmo PDF ao achar que a página travou, queimando dois créditos.
 * Ela cumpria esse papel, mas cobrava o preço de bloquear também o envio
 * legítimo de documentos DIFERENTES em sequência, que é exatamente o que um
 * cliente B2B faz.
 *
 * Reconhecer o reenvio pelo conteúdo resolve o problema original de forma direta
 * e sem efeito colateral: o mesmo arquivo, do mesmo tenant, dentro de uma janela
 * curta, devolve a análise já criada em vez de criar outra e cobrar de novo.
 * Arquivos diferentes seguem livremente, limitados apenas pela vazão do plano.
 *
 * O TTL é curto de propósito. Reanalisar o mesmo documento depois é legítimo (o
 * operador pode ter corrigido a coordenada de referência, por exemplo), então a
 * idempotência não pode virar bloqueio permanente.
 */
const IDEMPOTENCIA_TTL = Number(process.env.ANALYZE_IDEMPOTENCY_TTL) || 120;

function idempotencyKey(tenantId, base64) {
  const conteudo = crypto.createHash("sha256").update(base64).digest("hex").slice(0, 32);
  return `analyze:idem:${tenantId}:${conteudo}`;
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

/*
 * TTL do lock: teto de quanto uma análise pode demorar. Se o worker morrer no
 * meio, o lock expira sozinho e o tenant não fica travado para sempre.
 *
 * Derivava de `ANALYZE_TIMEOUT_MS`, que é o timeout da REQUISIÇÃO HTTP de
 * upload, não do processamento. Eram grandezas distintas: a rota responde 202 e
 * o trabalho continua no worker. Com o orçamento de OCR agora dimensionado pelo
 * número de páginas (até ~120s), o teto de 150s ficaria abaixo do pior caso, e
 * um lock expirado permite uma segunda análise do mesmo tenant enquanto a
 * primeira ainda roda. É justamente o que o mutex existe para impedir.
 *
 * Passa a derivar do custo real de processamento, com folga para o restante do
 * pipeline (extração, geolocalização, persistência).
 */
const ANALYSIS_LOCK_TTL = Math.ceil(ocrBudgetMs() / 1000) + 120;

export async function analyzePdf(req, res) {
  const { userId, tenantId } = req.auth;
  let lockToken = null;
  let analysis = null;
  let pdfKey = null;

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

    // Reenvio do MESMO arquivo dentro da janela curta devolve a análise que já
    // existe, sem criar outra nem cobrar de novo. Verificado antes do semáforo e
    // do débito: um duplo-clique não deve nem ocupar slot.
    const chaveIdem = idempotencyKey(tenantId, validation.base64);
    try {
      const existente = await redis.get(chaveIdem);
      if (existente) {
        return res.status(202).json({
          analysisId: existente,
          status: "PROCESSING",
          reaproveitada: true,
        });
      }
    } catch (err) {
      // Fail-open: sem Redis, o pior caso é o comportamento de antes da
      // idempotência, que é criar uma segunda análise.
      console.error("[Analyze] Verificação de idempotência falhou:", err.message);
    }

    /*
     * Análises simultâneas por tenant, conforme o PLANO.
     *
     * Era um mutex de slot único, calibrado para escritório com um operador. Num
     * cliente com dez funcionários, os dez disputavam a mesma vaga e o segundo
     * recebia 409 com a plataforma ociosa. O semáforo concede N vagas, e N = 1
     * (o default) reproduz exatamente o comportamento anterior.
     */
    const { maxConcurrentAnalyses } = await getPlanLimits(tenantId);
    const slot = await acquireSlot(
      analysisLockKey(tenantId),
      maxConcurrentAnalyses,
      ANALYSIS_LOCK_TTL,
      userId
    );
    lockToken = slot.token;

    if (!lockToken) {
      /*
       * As duas recusas têm causas diferentes e exigem ações diferentes de quem
       * lê. "A equipe está usando tudo" é capacidade do plano, e a saída é
       * esperar ou contratar mais. "Sua parte está cheia" significa que há vaga,
       * mas ela está reservada aos colegas: a saída é aguardar as suas próprias
       * análises terminarem. Uma mensagem única mandaria metade dos clientes
       * para o caminho errado.
       */
      const porCota = slot.motivo === SLOT_COTA_DO_USUARIO;
      return res.status(409).json({
        error: porCota
          ? "Você atingiu sua parte das análises simultâneas da equipe. Aguarde a conclusão de uma das suas para iniciar outra."
          : maxConcurrentAnalyses === 1
            ? "Já existe uma análise em andamento. Aguarde a conclusão para iniciar outra."
            : `As ${maxConcurrentAnalyses} análises simultâneas do seu plano estão em uso pela equipe. Aguarde a conclusão de uma delas.`,
        code: porCota ? "ANALYSIS_USER_QUOTA" : "ANALYSIS_IN_PROGRESS",
        limite: maxConcurrentAnalyses,
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

    /*
     * ─── O PDF sai do payload do job ─────────────────────────────────────────
     *
     * Gravado ANTES de enfileirar: se o armazenamento falhar, a análise ainda
     * não foi para a fila e o catch abaixo estorna o crédito. Se fosse depois, o
     * worker pegaria um job cuja chave não existe.
     *
     * `putPdf` devolve null quando a gravação falha (disco cheio, permissão), e
     * nesse caso o job volta a carregar o base64. É degradação deliberada: pior
     * consumo de memória do Redis é aceitável, análise que não roda não é.
     */
    pdfKey = await putPdf(
      buildKey(tenantId, analysis.id),
      Buffer.from(validation.base64, "base64")
    );
    if (pdfKey) {
      await prisma.analysis
        .update({ where: { id: analysis.id }, data: { pdfObjectKey: pdfKey } })
        .catch((err) => console.error("[Analyze] Falha ao gravar a chave do PDF:", err.message));
    } else {
      console.warn(`[Analyze] Armazenamento indisponível para ${analysis.id}: job seguirá com base64.`);
    }

    // Cache e alerta só depois do commit: dentro da transação, um rollback
    // deixaria o cache invalidado e o alerta enviado por um débito desfeito.
    await afterDebitCommit(tenantId, debit.balanceBefore);

    // Enfileira ANTES de responder: se a fila estiver fora do ar, o crédito
    // debitado precisa voltar em vez de deixar a análise presa em PROCESSING.
    await analysisQueue.add(
      "process-pdf",
      {
        analysisId: analysis.id,
        // Um OU outro, nunca os dois: enviar os dois anularia o ganho de memória.
        pdfKey: pdfKey || undefined,
        pdfBase64: pdfKey ? undefined : validation.base64,
        tenantId,
        userId,
        lockToken,
        homeAddress: home,
        homeCoord,
        filename: filename || null,
      },
      { attempts: 1, removeOnComplete: true, removeOnFail: true }
    );

    // Só depois de a análise estar enfileirada: gravar antes faria um envio que
    // falhou no meio devolver um analysisId que nunca vai ser processado.
    await redis
      .setex(chaveIdem, IDEMPOTENCIA_TTL, analysis.id)
      .catch((err) => console.error("[Analyze] Falha ao gravar idempotência:", err.message));

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
    await releaseSlot(analysisLockKey(tenantId), lockToken);

    // O objeto já foi enviado mas a análise não vai acontecer: deixá-lo no
    // bucket seria guardar dado pessoal de um processamento que nunca existiu,
    // e a rotina de expurgo não o alcançaria (ela seleciona por análise).
    if (pdfKey) await deletePdf(pdfKey);

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
    // `select` explícito: sem ele o Prisma trazia a linha inteira, INCLUSIVE o
    // campo `result`, que é o laudo estruturado completo. A tela consulta este
    // endpoint a cada 2 segundos, então uma análise de 60 segundos carregava o
    // laudo inteiro do banco 30 vezes para descartar tudo menos duas colunas.
    const analysis = await prisma.analysis.findUnique({
      where: { id: req.params.id },
      select: { tenantId: true, status: true, createdAt: true },
    });
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
