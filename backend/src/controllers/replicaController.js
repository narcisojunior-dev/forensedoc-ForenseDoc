import crypto from "node:crypto";
import { prisma } from "../utils/prisma.js";
import { analysisQueue } from "../queues.js";
import { acquireSlot, releaseSlot, analysisLockKey, SLOT_COTA_DO_USUARIO } from "../utils/lock.js";
import { getPlanLimits } from "../services/planLimitsService.js";
import { putPdf, deletePdf } from "../services/objectStorageService.js";
import { buildReplicaDraft, listReplicaScenarios } from "../engine/replicas/index.js";
import {
  salvarReplica, lerReplica, atualizarReplica, listarReplicas, apagarReplica, REPLICA_TTL_SECONDS,
} from "../services/replicaStore.js";
import { validarDocumentosReplica } from "../services/replicaValidation.js";

export { REPLICA_MAX_TOTAL_MB } from "../services/replicaValidation.js";

/**
 * Réplica processual (Motor de Réplicas, portado do motor de geração).
 *
 * Fluxo: o advogado envia inicial, contestação e documentos; o worker lê os
 * autos, cruza com o Caderno de Réplicas e devolve achados com arquivo, página
 * e trecho, além dos cenários candidatos. Depois da conferência humana
 * declarada, a minuta é montada a partir da análise GUARDADA no servidor, e não
 * de uma cópia enviada pelo navegador, para que a peça corresponda ao que foi
 * efetivamente lido.
 *
 * Toda minuta sai com `readyForFiling: false`.
 */

// A leitura dos autos pode aplicar OCR em dezenas de páginas e o bridge Python
// tem teto de 10 minutos. O slot precisa sobreviver a esse pior caso.
const SLOT_TTL = 15 * 60;

/** Visão de listagem: sem a análise completa, que pode ser grande. */
function resumo(registro) {
  return {
    id: registro.id,
    status: registro.status,
    createdAt: registro.createdAt,
    updatedAt: registro.updatedAt || null,
    expiresAt: registro.expiresAt,
    files: (registro.files || []).map(({ name, sizeBytes }) => ({ name, sizeBytes })),
    signals: registro.result?.signals?.length ?? null,
    candidates: (registro.result?.candidates || []).map((c) => c.letra),
    hasDraft: Boolean(registro.draft),
  };
}

function audit(req, action, metadata) {
  return prisma.auditLog
    .create({
      data: {
        tenantId: req.tenantId,
        userId: req.auth.userId,
        action,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata,
      },
    })
    .catch((err) => console.error(`[Replica] Falha ao registrar ${action}:`, err.message));
}

export async function startReplica(req, res) {
  const { userId, tenantId } = req.auth;
  const replicaId = crypto.randomUUID();
  let lockToken = null;
  const chaves = [];

  try {
    const validacao = validarDocumentosReplica(req.body?.documents);
    if (!validacao.ok) {
      return res.status(400).json({ error: validacao.error, detalhes: validacao.detalhes });
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

    const dia = new Date().toISOString().slice(0, 10);
    const arquivosDoJob = [];
    for (const [indice, arquivo] of validacao.arquivos.entries()) {
      // Chave sem o nome original: nomes de peça trazem nome da parte e número
      // do processo, e a chave aparece em log.
      const chave = `${tenantId}/${dia}/replicas/${replicaId}/${String(indice + 1).padStart(3, "0")}${arquivo.extensao}`;
      const gravada = await putPdf(chave, arquivo.buffer);
      if (!gravada) throw new Error("Armazenamento de uploads indisponível para os autos da réplica.");
      chaves.push(gravada);
      arquivosDoJob.push({ key: gravada, name: arquivo.name });
    }

    const agora = new Date();
    await salvarReplica(tenantId, {
      id: replicaId,
      tenantId,
      userId,
      status: "PROCESSING",
      createdAt: agora.toISOString(),
      expiresAt: new Date(agora.getTime() + REPLICA_TTL_SECONDS * 1000).toISOString(),
      files: validacao.arquivos.map(({ name, sizeBytes, sha256 }) => ({ name, sizeBytes, sha256 })),
      result: null,
      draft: null,
    });

    await analysisQueue.add(
      "replica-analyze",
      { replicaId, tenantId, userId, lockToken, files: arquivosDoJob, ocr: req.body?.ocr !== false },
      { attempts: 1, removeOnComplete: true, removeOnFail: true }
    );

    await audit(req, "replica_started", {
      replicaId,
      documentos: validacao.arquivos.length,
      totalBytes: validacao.totalBytes,
    });

    return res.status(202).json({ replicaId, status: "PROCESSING" });
  } catch (error) {
    await releaseSlot(analysisLockKey(tenantId), lockToken);
    for (const chave of chaves) await deletePdf(chave);
    await apagarReplica(tenantId, replicaId).catch(() => {});
    console.error("[Replica] Erro ao iniciar réplica:", error);
    return res.status(500).json({ error: "Erro interno." });
  }
}

export async function listReplicas(req, res) {
  try {
    const registros = await listarReplicas(req.tenantId);
    return res.json({ replicas: registros.map(resumo), retentionHours: REPLICA_TTL_SECONDS / 3600 });
  } catch (error) {
    console.error("[Replica] Erro ao listar:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getReplica(req, res) {
  try {
    const registro = await lerReplica(req.tenantId, req.params.id);
    if (!registro) return res.status(404).json({ error: "Réplica não encontrada ou expirada." });
    const { tenantId: _t, ...publico } = registro;
    return res.json({ replica: publico });
  } catch (error) {
    console.error("[Replica] Erro ao buscar:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

let cenariosEmMemoria = null;

export async function listScenarios(_req, res) {
  try {
    // O caderno é versionado junto do código: não muda sem novo deploy.
    cenariosEmMemoria = cenariosEmMemoria || (await listReplicaScenarios());
    return res.json(cenariosEmMemoria);
  } catch (error) {
    console.error("[Replica] Erro ao listar cenários:", error);
    return res.status(503).json({ error: "Motor de Réplicas indisponível neste servidor." });
  }
}

/** Só texto curto: os dados do caso entram na peça como estão. */
function sanitizarDadosDoCaso(entrada) {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return {};
  const saida = {};
  for (const [chave, valor] of Object.entries(entrada).slice(0, 80)) {
    if (!/^[\w.-]{1,60}$/.test(chave)) continue;
    if (valor === null || ["string", "number", "boolean"].includes(typeof valor)) {
      saida[chave] = typeof valor === "string" ? valor.slice(0, 1000) : valor;
    }
  }
  return saida;
}

export async function draftReplica(req, res) {
  try {
    const registro = await lerReplica(req.tenantId, req.params.id);
    if (!registro) return res.status(404).json({ error: "Réplica não encontrada ou expirada." });
    if (registro.status !== "COMPLETED" || !registro.result?.analysis) {
      return res.status(409).json({ error: "A leitura dos autos ainda não foi concluída." });
    }

    const { letter, reviewConfirmed, caseData, preliminaries } = req.body || {};
    if (reviewConfirmed !== true) {
      return res.status(400).json({ error: "Confirme a conferência humana das evidências antes de montar a minuta." });
    }
    const letra = String(letter || "").toUpperCase();
    if (!/^[A-Z]$/.test(letra)) {
      return res.status(400).json({ error: "Selecione um cenário de réplica." });
    }

    const analise = registro.result.analysis;
    const preliminaresPadrao = (analise.preliminares || []).map((item) => item.cod).filter(Boolean);
    const preliminaresEscolhidas = Array.isArray(preliminaries)
      ? preliminaries.filter((p) => typeof p === "string" && p.length <= 40).slice(0, 40)
      : preliminaresPadrao;

    let minuta;
    try {
      minuta = await buildReplicaDraft({
        reviewConfirmed: true,
        letter: letra,
        analysis: analise,
        caseData: { ...(analise.dados || {}), ...sanitizarDadosDoCaso(caseData) },
        preliminaries: preliminaresEscolhidas,
        conformity: analise.conformidade69 || [],
      });
    } catch (erroDoMotor) {
      // Pré-requisito ausente ou cenário inválido: é resposta do motor ao
      // conteúdo dos autos, não falha do servidor.
      return res.status(422).json({ error: erroDoMotor.message || "O motor recusou a montagem da minuta." });
    }

    const draft = {
      ...minuta,
      letter: letra,
      reviewedBy: req.auth.userId,
      reviewedAt: new Date().toISOString(),
    };
    await atualizarReplica(req.tenantId, registro.id, () => ({ draft }));
    await audit(req, "replica_draft_built", { replicaId: registro.id, letter: letra });

    return res.json({ draft });
  } catch (error) {
    console.error("[Replica] Erro ao montar minuta:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function deleteReplica(req, res) {
  try {
    const removida = await apagarReplica(req.tenantId, req.params.id);
    if (!removida) return res.status(404).json({ error: "Réplica não encontrada ou expirada." });
    await audit(req, "replica_deleted", { replicaId: req.params.id });
    return res.status(204).end();
  } catch (error) {
    console.error("[Replica] Erro ao apagar:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
