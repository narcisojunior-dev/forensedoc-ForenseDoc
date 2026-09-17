import crypto from "node:crypto";
import path from "node:path";

/**
 * Validação dos autos enviados para a réplica processual.
 *
 * Isolada do controller para ser testável sem banco nem fila, e para que os
 * limites tenham um só lugar: a rota usa `REPLICA_MAX_TOTAL_MB` para dimensionar
 * o parser do corpo.
 */

export const REPLICA_MAX_FILES = Number(process.env.REPLICA_MAX_FILES) || 30;
export const REPLICA_MAX_FILE_MB = Number(process.env.REPLICA_MAX_FILE_MB || process.env.MAX_PDF_MB) || 30;
export const REPLICA_MAX_TOTAL_MB = Number(process.env.REPLICA_MAX_TOTAL_MB) || 80;

const ASSINATURAS = {
  ".pdf": [Buffer.from("%PDF-")],
  ".png": [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ".jpg": [Buffer.from([0xff, 0xd8, 0xff])],
  ".jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  ".txt": null,
};

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Valida o lote INTEIRO antes de gravar qualquer arquivo ou ocupar slot, e
 * devolve todos os problemas de uma vez.
 */
export function validarDocumentosReplica(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return { ok: false, error: "Envie ao menos um documento do processo." };
  }
  if (documents.length > REPLICA_MAX_FILES) {
    return { ok: false, error: `O limite é de ${REPLICA_MAX_FILES} documentos por réplica.` };
  }

  const arquivos = [];
  const erros = [];
  let total = 0;

  documents.forEach((doc, indice) => {
    const nome = String(doc?.name || `documento-${indice + 1}`).slice(0, 200);
    const extensao = path.extname(nome).toLowerCase();
    if (!(extensao in ASSINATURAS)) {
      erros.push(`${nome}: formato não permitido (use PDF, PNG, JPG ou TXT).`);
      return;
    }
    const base64 = String(doc?.base64 || "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!base64 || !BASE64_RE.test(base64)) {
      erros.push(`${nome}: arquivo inválido ou corrompido.`);
      return;
    }
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) {
      erros.push(`${nome}: arquivo vazio.`);
      return;
    }
    if (buffer.length > REPLICA_MAX_FILE_MB * 1024 * 1024) {
      erros.push(`${nome}: excede ${REPLICA_MAX_FILE_MB} MB.`);
      return;
    }
    const assinaturas = ASSINATURAS[extensao];
    if (assinaturas && !assinaturas.some((a) => buffer.subarray(0, a.length).equals(a))) {
      erros.push(`${nome}: o conteúdo não corresponde à extensão ${extensao}.`);
      return;
    }
    total += buffer.length;
    arquivos.push({
      name: nome,
      extensao,
      buffer,
      sizeBytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase(),
    });
  });

  if (erros.length) return { ok: false, error: "Há documentos inválidos.", detalhes: erros };
  if (total > REPLICA_MAX_TOTAL_MB * 1024 * 1024) {
    return { ok: false, error: `O conjunto de documentos excede ${REPLICA_MAX_TOTAL_MB} MB.` };
  }
  return { ok: true, arquivos, totalBytes: total };
}

