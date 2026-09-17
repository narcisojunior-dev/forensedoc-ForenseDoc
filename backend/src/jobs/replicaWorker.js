import { releaseSlot, analysisLockKey } from "../utils/lock.js";
import { getPdf, deletePdf } from "../services/objectStorageService.js";
import { analyzeReplicaDocuments } from "../engine/replicas/index.js";
import { atualizarReplica } from "../services/replicaStore.js";

/**
 * Leitura dos autos pelo Motor de Réplicas.
 *
 * Roda na fila de análise porque o perfil é o mesmo: OCR e processamento de
 * texto limitados por CPU, de segundos a minutos. Os arquivos enviados são
 * apagados no `finally`, com sucesso ou falha: o que fica é a análise com as
 * evidências localizadas e o SHA-256 de cada documento.
 */
export async function processReplica(job) {
  const { replicaId, tenantId, lockToken, files = [], ocr = true } = job.data;

  try {
    const documents = [];
    for (const file of files) {
      documents.push({ name: file.name, buffer: await getPdf(file.key) });
    }

    const result = await analyzeReplicaDocuments(documents, { ocr });

    await atualizarReplica(tenantId, replicaId, () => ({
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      result,
      error: null,
    }));
  } catch (error) {
    console.error(`[ReplicaWorker] Falha na réplica ${replicaId}:`, error.message);
    // A mensagem do motor é voltada ao usuário ("o PDF não possui texto
    // pesquisável", "formato não permitido"); erros internos não vazam detalhe.
    const mensagem = /^(Não foi possível ler|Formato não permitido|Documento \d+|O PDF |O limite|Envie ao menos|Nenhum documento)/.test(error.message || "")
      ? error.message
      : "Não foi possível ler os autos. Verifique os arquivos e tente novamente.";
    await atualizarReplica(tenantId, replicaId, () => ({
      status: "ERROR",
      completedAt: new Date().toISOString(),
      error: mensagem,
    })).catch((err) => console.error("[ReplicaWorker] Falha ao registrar erro:", err.message));
  } finally {
    for (const file of files) await deletePdf(file.key);
    await releaseSlot(analysisLockKey(tenantId), lockToken);
  }
}
