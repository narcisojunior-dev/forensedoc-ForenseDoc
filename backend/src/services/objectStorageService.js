import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile, unlink, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import "dotenv/config";

/**
 * Armazenamento do PDF enviado, em disco local.
 *
 * ─── Por que o arquivo saiu da fila ──────────────────────────────────────────
 *
 * O PDF trafegava dentro do payload do job, e o BullMQ guarda payload no
 * **Redis, que é MEMÓRIA**: base64 acrescenta cerca de 33%, então um dossiê de
 * 10 MB ocupava perto de 13 MB de RAM enquanto esperasse na fila, e um pico de
 * cem análises chegava a gigabytes. O Redis também guarda sessão, rate limit e
 * cache; quando ele estoura, começa a despejar chaves e a degradação aparece
 * espalhada, sem nada apontar para a causa.
 *
 * Disco nunca foi o problema. MEMÓRIA era. Por isso qualquer armazenamento fora
 * do Redis resolve, e o job passou a carregar só a chave do arquivo.
 *
 * ─── Por que disco local e não armazenamento de objetos ──────────────────────
 *
 * A primeira implementação usava Cloudflare R2. Foi trocada por decisão de
 * PROTEÇÃO DE DADOS, não técnica: o dossiê contém CPF, endereço e por vezes
 * referência biométrica de terceiro, e mandá-lo para fora do país configura
 * transferência internacional sob a LGPD (art. 33), com base legal e
 * salvaguardas contratuais próprias. Mantendo o arquivo no disco do próprio
 * servidor, essa discussão deixa de existir.
 *
 * O que se abre mão, e vale saber:
 *
 *   - o arquivo não sobrevive à perda do servidor (mas o laudo sim, e com ele os
 *     hashes que provam a integridade do que foi analisado);
 *   - um worker em OUTRO host não enxerga este disco. Ao escalar por réplica,
 *     todas precisam compartilhar o volume, ou o armazenamento volta a ser
 *     externo;
 *   - o disco é finito. Com retenção de 30 dias e ~10 MB por dossiê escaneado,
 *     50 análises/dia ocupam cerca de 15 GB.
 *
 * ─── Degradação sem diretório utilizável ─────────────────────────────────────
 *
 * Se o diretório não puder ser criado ou escrito, `putPdf` devolve null e o
 * sistema volta ao payload em base64. Disco cheio ou permissão errada é problema
 * de operação, e a resposta certa é piorar o consumo de memória, não recusar a
 * análise que o cliente pagou. A falha é registrada para aparecer no
 * monitoramento.
 */

/** Raiz do armazenamento. No container, precisa ser um volume compartilhado. */
const RAIZ = path.resolve(process.env.UPLOAD_DIR || "./data/uploads");

/**
 * Retenção do PDF ORIGINAL.
 *
 * Trinta dias. O prazo é curto por decisão de proteção de dados: o arquivo é o
 * dossiê do banco e carrega dado pessoal de terceiro. O laudo preserva SHA-256 e
 * SHA-1, então a integridade do que foi analisado continua demonstrável depois
 * que o original deixa de existir.
 *
 * Nada no sistema lê este arquivo depois que a análise termina: o laudo é gerado
 * a partir do `result` já persistido, e a correção de coordenada recalcula as
 * distâncias sem tocar no PDF. A janela existe para o que é excepcional, ou seja
 * reprocessar a extração após um ajuste do sistema e responder a contestação
 * imediata do cliente.
 *
 * Ver o documento de auditoria, §12.6, para o racional completo e para a
 * distinção entre controlador e operador.
 */
export const RETENCAO_DIAS = Number(process.env.UPLOAD_RETENTION_DAYS) || 30;

/** Disco local está sempre disponível; a checagem existe pela interface. */
export function isConfigured() {
  return true;
}

/**
 * Chave do arquivo, relativa à raiz.
 *
 * Prefixada por tenant para que uma exclusão em massa (encerramento de contrato,
 * pedido de eliminação sob a LGPD, art. 18) seja uma subárvore, e não uma
 * varredura. A data facilita inspeção manual.
 *
 * O nome do arquivo original NÃO entra: nomes de dossiê costumam trazer o nome
 * do contratante e o número do contrato, e a chave aparece em log e em métrica.
 */
export function buildKey(tenantId, analysisId) {
  const dia = new Date().toISOString().slice(0, 10);
  const aleatorio = crypto.randomBytes(6).toString("hex");
  return `${tenantId}/${dia}/${analysisId}-${aleatorio}.pdf`;
}

/**
 * Resolve a chave para um caminho absoluto, recusando fuga da raiz.
 *
 * As chaves vêm do próprio banco, mas isto é defesa em profundidade: um `..`
 * numa chave corrompida transformaria leitura de dossiê em leitura de qualquer
 * arquivo do servidor, e exclusão de dossiê em exclusão arbitrária.
 */
function caminhoDe(key) {
  const destino = path.resolve(RAIZ, key);
  if (destino !== RAIZ && !destino.startsWith(RAIZ + path.sep)) {
    throw new Error(`Chave de arquivo fora da raiz de armazenamento: ${key}`);
  }
  return destino;
}

/**
 * Grava o PDF. Devolve a chave, ou null se não foi possível (o chamador cai no
 * payload em base64).
 */
export async function putPdf(key, buffer) {
  try {
    const destino = caminhoDe(key);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, buffer, { mode: 0o640 });
    return key;
  } catch (err) {
    console.error(`[Storage] Falha ao gravar '${key}':`, err.message);
    return null;
  }
}

/** Lê o PDF. Lança se falhar: sem o arquivo não há análise a fazer. */
export async function getPdf(key) {
  return readFile(caminhoDe(key));
}

export async function deletePdf(key) {
  if (!key) return;
  try {
    await unlink(caminhoDe(key));
  } catch (err) {
    // Arquivo já ausente é sucesso: o objetivo é que ele não exista.
    if (err.code !== "ENOENT") console.error(`[Storage] Falha ao apagar '${key}':`, err.message);
  }
}

/** Apaga em lote. Devolve quantos deixaram de existir. */
export async function deletePdfs(keys) {
  if (!keys?.length) return 0;
  let removidos = 0;
  for (const key of keys) {
    try {
      await unlink(caminhoDe(key));
      removidos++;
    } catch (err) {
      // ENOENT conta como removido: o arquivo não está mais lá, que é o fim
      // pretendido. Tratá-lo como falha faria a rotina reprocessar para sempre.
      if (err.code === "ENOENT") removidos++;
      else console.error(`[Storage] Falha ao apagar '${key}':`, err.message);
    }
  }
  return removidos;
}

/**
 * Confere no start que a raiz existe e é gravável.
 *
 * Sem isto, a primeira falha só apareceria na primeira análise, e como o sistema
 * degrada para base64 em silêncio, ela apareceria como consumo alto de memória
 * em vez de erro de permissão.
 */
export async function ensureStorageReady() {
  try {
    await mkdir(RAIZ, { recursive: true });
    await access(RAIZ, fsConstants.W_OK);
    console.log(`[Storage] Diretório de uploads: ${RAIZ} (retenção de ${RETENCAO_DIAS} dias)`);
    return true;
  } catch (err) {
    console.error(
      `[Storage] Diretório '${RAIZ}' não é gravável (${err.message}). ` +
        `As análises seguirão com o PDF no payload do job, consumindo memória do Redis.`
    );
    return false;
  }
}
