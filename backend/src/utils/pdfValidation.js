import { cleanPdfBase64 } from "./stringUtils.js";

/**
 * Validação do upload antes de qualquer processamento (Seção 2.3 do plano).
 *
 * Roda na API, não no worker: um payload inválido não pode consumir crédito,
 * ocupar a fila nem chegar ao OCR.
 */

export const MAX_PDF_BYTES = Number(process.env.MAX_PDF_MB || 30) * 1024 * 1024;

// "%PDF-" — assinatura obrigatória no início de todo PDF (ISO 32000-1).
// Checar a extensão ou o content-type não vale nada: ambos vêm do cliente.
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

// Base64 estrito: apenas o alfabeto padrão e padding no fim.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Tamanho real do binário sem precisar decodificar tudo. */
function decodedByteLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * @returns {{ ok: true, sizeBytes: number, base64: string }
 *          | { ok: false, error: string, code: string }}
 */
export function validatePdfPayload(rawBase64) {
  if (!rawBase64 || typeof rawBase64 !== "string") {
    return { ok: false, error: "Arquivo PDF ausente.", code: "PDF_MISSING" };
  }

  const base64 = cleanPdfBase64(rawBase64);

  if (!base64 || !BASE64_RE.test(base64)) {
    return { ok: false, error: "Arquivo inválido ou corrompido.", code: "PDF_INVALID_ENCODING" };
  }

  const sizeBytes = decodedByteLength(base64);

  if (sizeBytes === 0) {
    return { ok: false, error: "Arquivo vazio.", code: "PDF_EMPTY" };
  }

  // Verificado antes de decodificar: um payload de 100 MB não pode virar
  // Buffer na memória só para depois ser rejeitado.
  if (sizeBytes > MAX_PDF_BYTES) {
    const limitMb = Math.round(MAX_PDF_BYTES / 1024 / 1024);
    return {
      ok: false,
      error: `O PDF excede o limite de ${limitMb} MB.`,
      code: "PDF_TOO_LARGE",
    };
  }

  // Decodifica só o cabeçalho para conferir os magic bytes. 8 caracteres de
  // base64 já cobrem os 5 bytes da assinatura.
  let header;
  try {
    header = Buffer.from(base64.slice(0, 8), "base64");
  } catch {
    return { ok: false, error: "Arquivo inválido ou corrompido.", code: "PDF_INVALID_ENCODING" };
  }

  if (!header.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return {
      ok: false,
      error: "O arquivo enviado não é um PDF válido.",
      code: "PDF_INVALID_SIGNATURE",
    };
  }

  return { ok: true, sizeBytes, base64 };
}
