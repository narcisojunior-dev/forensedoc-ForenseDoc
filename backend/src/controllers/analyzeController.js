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
import { recomputeDerived } from "../services/analysisRecompute.js";
import { geocodeAddress, reverseGeocode } from "../services/geocodingService.js";
import { ESTADO_CONFRONTO, avaliarConflitoReferencia, descreverEstadoConfronto } from "../utils/referenciaResidencial.js";
import {
  CAMPOS_REVISAVEIS,
  validarCampos,
  lerCaminho,
  escreverCaminho,
} from "../services/fieldReview.js";
import { getIpInfo } from "../services/apiService.js";
import { parsePagination } from "../utils/pagination.js";
import { redis } from "../utils/redis.js";
import { putPdf, buildKey, deletePdf } from "../services/objectStorageService.js";
import { temCreditoIlimitado } from "../utils/creditPolicy.js";

/** O extraído é persistido como texto JSON dentro do resultado. */
function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

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
/**
 * Contestação do endereço do instrumento pelo operador. Só vale com
 * justificativa: é ela que o laudo imprime ao liberar um confronto que o próprio
 * instrumento contradiz.
 */
function parseContestacao(contestado, justificativa) {
  if (contestado !== true && contestado !== "true") return null;
  const texto = typeof justificativa === "string" ? justificativa.trim().slice(0, 500) : "";
  return { contestado: true, justificativa: texto };
}

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
  // Administrador da plataforma: sem débito e, portanto, sem estorno.
  const creditoIsento = temCreditoIlimitado(req.auth);
  let lockToken = null;
  let analysis = null;
  let pdfKey = null;

  try {
    const { pdfBase64, filename, homeAddress, homeLat, homeLon, homeAddressContested, homeAddressJustification } = req.body || {};

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
    const homeContestacao = parseContestacao(homeAddressContested, homeAddressJustification);
    if (homeContestacao && homeContestacao.justificativa.length < 15) {
      return res.status(400).json({
        error: "Para declarar contestado o endereço do instrumento, escreva a justificativa (pelo menos 15 caracteres). Ela é impressa no laudo.",
        code: "JUSTIFICATIVA_OBRIGATORIA",
      });
    }

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

      if (creditoIsento) return { created, balanceBefore: null };

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
    if (!creditoIsento) await afterDebitCommit(tenantId, debit.balanceBefore);

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
        homeContestacao,
        filename: filename || null,
        creditoIsento,
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
          metadata: { analysisId: analysis.id, sizeBytes: validation.sizeBytes, creditoIsento },
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
    if (analysis && creditoIsento) {
      // Nada foi debitado: basta não deixar a análise presa em PROCESSING.
      await prisma.analysis
        .update({ where: { id: analysis.id }, data: { status: "ERROR" } })
        .catch((err) => console.error("[Analyze] Falha ao marcar análise isenta como erro:", err.message));
    } else if (analysis) {
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
    const extraido = safeParse(result.text) || {};

    // A coordenada do operador passa pela mesma conferência do endereço digitado
    // na análise: em outra UF ou longe do município do instrumento, só entra
    // com o endereço do instrumento declarado contestado e justificado.
    const contestacao = parseContestacao(req.body?.contestado, req.body?.justificativa);
    const conflito = await avaliarConflitoReferencia({
      cliente: extraido.cliente || {},
      enderecoManual: null,
      pontoManual: coord,
      servicos: { geocodeAddress, reverseGeocode },
    });
    if (conflito && !(contestacao && contestacao.justificativa.length >= 15)) {
      return res.status(409).json({
        error: `A coordenada conflita com o endereço do instrumento: ${conflito.descricao}. Para usá-la, declare o endereço do instrumento contestado e escreva a justificativa (pelo menos 15 caracteres).`,
        code: "CONFLITO_REFERENCIA",
        conflito,
      });
    }

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
      estado_confronto: conflito ? ESTADO_CONFRONTO.LIBERADO_PELO_OPERADOR : ESTADO_CONFRONTO.DISPONIVEL,
      conflito,
      justificativa: conflito ? contestacao.justificativa : null,
      instrumento: result.home?.instrumento || null,
      endereco_literal: result.home?.endereco_literal || null,
    };
    result.home.alerta = descreverEstadoConfronto(result.home);

    /*
     * Recalcula TUDO que deriva da coordenada, e não só as distâncias.
     *
     * A versão anterior atualizava os quilômetros e deixava as classificações
     * intactas: o laudo passava a exibir a distância nova ao lado do rótulo
     * antigo, com 12 km marcados como "DIVERGÊNCIA GRAVE" porque a classificação
     * era de quando a distância era 800. Número e veredito se contradiziam
     * dentro da mesma linha.
     */
    const corrigido = recomputeDerived(result, extraido);
    corrigido.geoCorrectedAt = new Date().toISOString();

    await prisma.analysis.update({ where: { id: analysis.id }, data: { result: corrigido } });

    await prisma.auditLog
      .create({
        data: {
          tenantId: req.tenantId,
          userId: req.auth.userId,
          action: "analysis_geo_corrected",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { analysisId: analysis.id, lat: coord.lat, lon: coord.lon, conflitoLiberado: Boolean(conflito) },
        },
      })
      .catch(() => {});

    return res.json({ result: corrigido });
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

/**
 * Revisão dos campos extraídos, antes de emitir o laudo.
 *
 * ─── O que esta rota resolve ─────────────────────────────────────────────────
 *
 * A extração é heurística e frágil a formato novo: três documentos de bancos
 * diferentes revelaram três falhas distintas. Corrigir cada padrão é necessário
 * e nunca vai cobrir o próximo formato.
 *
 * Deixar o operador conferir e completar resolve por outro caminho, e um que
 * FORTALECE a peça: o laudo deixa de ser saída de uma heurística e passa a ser
 * saída conferida por pessoa identificada. É o que os Termos de Uso já exigem;
 * aqui a exigência vira registro.
 *
 * ─── Conformidade com o desenho de escala ────────────────────────────────────
 *
 * Esta rota NÃO entra na fila e NÃO ocupa slot do semáforo. O trabalho é uma
 * escrita no banco mais recálculo local em microssegundos, ou seja, perfil
 * oposto ao da análise, que é CPU pesada por minutos. Enfileirá-la faria a
 * correção esperar atrás de OCR, exatamente a inversão de prioridade que a
 * separação de filas foi feita para eliminar.
 *
 * A única consulta externa possível é a geolocalização de um IP alterado, que
 * passa pelo cache de 30 dias já existente. O limite de requisições é o do
 * plano, que já cresce com a capacidade contratada.
 */
export async function reviewAnalysisFields(req, res) {
  try {
    const analysis = await prisma.analysis.findUnique({ where: { id: req.params.id } });
    if (!analysis || analysis.tenantId !== req.tenantId) {
      return res.status(404).json({ error: "Análise não encontrada." });
    }
    if (analysis.status !== "COMPLETED" || !analysis.result) {
      return res.status(409).json({ error: "Só é possível revisar uma análise concluída." });
    }

    const { erros, validos, temErro } = validarCampos(req.body?.campos);
    if (temErro) {
      return res.status(400).json({ error: "Há campos inválidos.", campos: erros });
    }
    if (Object.keys(validos).length === 0) {
      return res.status(400).json({ error: "Nenhum campo para corrigir." });
    }

    const result = { ...analysis.result };
    const extracted = safeParse(result.text) || {};
    const revisadoPor = {
      userId: req.auth.userId,
      em: new Date().toISOString(),
    };

    const registro = { ...(result.camposRevisados || {}) };
    const alterados = [];
    let ipMudou = null;

    for (const [caminho, valor] of Object.entries(validos)) {
      const anterior = lerCaminho(extracted, caminho) ?? null;
      if (anterior === valor) continue;

      escreverCaminho(extracted, caminho, valor);
      alterados.push(caminho);

      /*
       * O laudo precisa DECLARAR o que foi conferido por pessoa, com o valor
       * anterior. Sem o anterior, não há como distinguir "o operador preencheu
       * o que faltava" de "o operador trocou o que o sistema tinha lido", e essa
       * distinção é justamente o que dá ou tira peso ao registro.
       */
      registro[caminho] = {
        rotulo: CAMPOS_REVISAVEIS[caminho].rotulo,
        anterior,
        valor,
        ...revisadoPor,
      };

      if (CAMPOS_REVISAVEIS[caminho].exigeGeoIp && valor) ipMudou = valor;
    }

    if (alterados.length === 0) {
      return res.status(200).json({ result, alterados: [] });
    }

    // ── Reflete no resultado o que os campos alimentam ──────────────────────
    const lat = Number(String(extracted.geolocalizacao_assinatura?.latitude ?? "").replace(",", "."));
    const lon = Number(String(extracted.geolocalizacao_assinatura?.longitude ?? "").replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      result.contractGeo = {
        ...(result.contractGeo || {}),
        lat,
        lon,
        // A origem muda: deixou de ser leitura automática do PDF.
        fonte: "Informado pelo operador na revisão",
        precision: "gps",
        geocoded: false,
      };
      result.geoDeclaredPresent = true;
    }

    if (ipMudou) {
      // Passa pelo cache de 30 dias: repetição do mesmo IP não custa consulta.
      const geo = await getIpInfo(ipMudou);
      const anterior = result.ipAnalysis?.[0] || {};
      result.ipAnalysis = [
        {
          ...anterior,
          endereco: ipMudou,
          versao: ipMudou.includes(":") ? 6 : 4,
          rotulo: anterior.rotulo || "Informado pelo operador na revisão",
          geo,
          geoFailure: geo ? null : "nenhum provedor de geolocalização respondeu",
        },
        ...(result.ipAnalysis || []).slice(1),
      ];
    }

    result.text = JSON.stringify(extracted);
    result.camposRevisados = registro;

    const corrigido = recomputeDerived(result, extracted);

    await prisma.analysis.update({ where: { id: analysis.id }, data: { result: corrigido } });

    await prisma.auditLog
      .create({
        data: {
          tenantId: req.tenantId,
          userId: req.auth.userId,
          action: "analysis_fields_reviewed",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          // Só os NOMES dos campos: os valores são dado pessoal de terceiro, e a
          // trilha de auditoria não é lugar para duplicá-los.
          metadata: { analysisId: analysis.id, campos: alterados },
        },
      })
      .catch((err) => console.error("[Analyze] Falha ao registrar revisão:", err.message));

    return res.json({ result: corrigido, alterados });
  } catch (error) {
    console.error("[Analyze] Erro ao revisar campos:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/** Catálogo dos campos revisáveis, para a tela montar o formulário. */
export async function listReviewableFields(_req, res) {
  return res.json({
    campos: Object.entries(CAMPOS_REVISAVEIS).map(([caminho, d]) => ({
      caminho,
      rotulo: d.rotulo,
      grupo: d.grupo,
      critico: Boolean(d.critico),
    })),
  });
}
