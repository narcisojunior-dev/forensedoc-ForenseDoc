import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PDFParse } from "pdf-parse";
import { stripPjeFooter } from "../pjeText.js";

const execFileAsync = promisify(execFile);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(MODULE_DIR, "bridge.py");
const ALLOWED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".txt"]);
const MAX_FILES = 200;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_LOGICAL_DOCUMENTS = 400;
const PJE_DOCUMENT_ID = /Num\.\s*(\d{5,})\s*-\s*P[áa]g\.\s*(\d+)/gi;

function safeName(name, index) {
  const ext = extname(String(name || "")).toLowerCase();
  if (!ALLOWED.has(ext)) throw new Error(`Formato não permitido: ${ext || "sem extensão"}.`);
  const stem = basename(String(name || `documento-${index}${ext}`), ext)
    .normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || `documento-${index}`;
  return `${String(index + 1).padStart(3, "0")}-${stem}${ext}`;
}

function decodeDocument(document, index) {
  // No SaaS os autos chegam do armazenamento de uploads já como Buffer; o
  // base64 continua aceito para quem chama o módulo diretamente.
  const buffer = Buffer.isBuffer(document?.buffer)
    ? document.buffer
    : Buffer.from(String(document?.base64 || "").replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length) throw new Error(`Documento ${index + 1} está vazio.`);
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`Documento ${index + 1} excede 80 MB.`);
  return { buffer, filename: safeName(document.name, index), originalName: String(document.name || `documento-${index + 1}`) };
}

function lastPjeDocumentId(text) {
  const matches = Array.from(String(text || "").matchAll(PJE_DOCUMENT_ID));
  return matches.at(-1)?.[1] || null;
}

async function extractPdfPages(buffer, originalName) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = (result.pages || []).map((page, index) => ({
      number: Number(page.num || index + 1),
      text: String(page.text || "").replace(/\u0000/g, " ").trim(),
    }));
    if (!pages.length) throw new Error("nenhuma página foi extraída");
    if (!pages.some((page) => page.text.replace(/\s+/g, "").length >= 20)) {
      throw new Error("o PDF não possui texto pesquisável; aplique OCR antes da análise");
    }
    return pages;
  } catch (error) {
    throw new Error(`Não foi possível ler ${originalName}: ${error.message || "PDF inválido"}.`);
  } finally {
    await parser.destroy();
  }
}

async function materializeForAnalysis(decoded, inputIndex, temp) {
  const extension = extname(decoded.filename).toLowerCase();
  const originalSha256 = createHash("sha256").update(decoded.buffer).digest("hex");
  if (extension !== ".pdf") {
    const path = join(temp, decoded.filename);
    await writeFile(path, decoded.buffer, { flag: "wx" });
    return [{
      path, originalName: decoded.originalName, displayName: decoded.originalName,
      sourceSha256: originalSha256, sourcePages: null, documentId: null,
      provenance: {
        kind: "original-upload", derived: false, tool: null,
        nativeMetadataAssessable: false,
        cryptographicSignatureAssessable: false,
      },
    }];
  }

  const pages = await extractPdfPages(decoded.buffer, decoded.originalName);
  const pageDocumentIds = pages.map((page) => lastPjeDocumentId(page.text));
  const isPjeNotebook = pageDocumentIds.some(Boolean);
  const groups = new Map();
  for (const [index, page] of pages.entries()) {
    const documentId = isPjeNotebook
      ? pageDocumentIds[index] || `front-${String(page.number).padStart(4, "0")}`
      : "pdf-completo";
    if (!groups.has(documentId)) groups.set(documentId, []);
    const cleaned = stripPjeFooter(page.text);
    groups.get(documentId).push({ ...page, text: cleaned.text, removedPjeFooter: cleaned.removed });
  }
  if (groups.size > MAX_LOGICAL_DOCUMENTS) {
    throw new Error(`O PDF ${decoded.originalName} contém ${groups.size} documentos lógicos; o limite é ${MAX_LOGICAL_DOCUMENTS}.`);
  }

  const logical = [];
  let sequence = 0;
  for (const [documentId, documentPages] of groups) {
    sequence += 1;
    const filename = `p${String(inputIndex + 1).padStart(3, "0")}-${String(sequence).padStart(3, "0")}_${documentId}.txt`;
    const path = join(temp, filename);
    await writeFile(path, documentPages.map((page) => page.text).join("\f"), { flag: "wx" });
    logical.push({
      path,
      originalName: decoded.originalName,
      displayName: `${decoded.originalName} · documento PJe ${documentId}`,
      sourceSha256: originalSha256,
      sourcePages: documentPages.map((page) => page.number),
      documentId,
      pjeFooterRemoved: documentPages.flatMap((page) => page.removedPjeFooter || []),
      provenance: {
        kind: groups.size > 1 ? "pje-text-split" : "pdf-text-extraction",
        derived: true,
        tool: "pdf-parse",
        nativeMetadataAssessable: false,
        cryptographicSignatureAssessable: false,
        pjeFooterFiltered: documentPages.some((page) => page.removedPjeFooter?.length),
      },
    });
  }
  return logical;
}

async function runBridge(payload) {
  const temp = await mkdtemp(join(tmpdir(), "forensedoc-replicas-command-"));
  try {
    const requestPath = join(temp, "request.json");
    await writeFile(requestPath, JSON.stringify(payload), { flag: "wx" });
    const { stdout } = await execFileAsync(process.env.PYTHON_PATH || "python3", [BRIDGE, requestPath], {
      cwd: MODULE_DIR, maxBuffer: 50 * 1024 * 1024, timeout: 10 * 60 * 1000,
    });
    const parsed = JSON.parse(stdout || "{}");
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  } catch (error) {
    if (error.stdout) {
      try {
        const parsed = JSON.parse(error.stdout);
        if (parsed.error) throw new Error(parsed.error);
      } catch (parsedError) {
        if (parsedError.message !== error.message) throw parsedError;
      }
    }
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function analyzeReplicaDocuments(documents, { ocr = true } = {}) {
  if (!Array.isArray(documents) || !documents.length) throw new Error("Envie ao menos um documento do processo.");
  if (documents.length > MAX_FILES) throw new Error(`O limite é de ${MAX_FILES} documentos por análise.`);
  const temp = await mkdtemp(join(tmpdir(), "forensedoc-replicas-"));
  try {
    const manifest = [];
    const logicalDocuments = [];
    for (const [index, document] of documents.entries()) {
      const decoded = decodeDocument(document, index);
      manifest.push({
        originalName: decoded.originalName,
        sha256: createHash("sha256").update(decoded.buffer).digest("hex"), size: decoded.buffer.length,
      });
      logicalDocuments.push(...await materializeForAnalysis(decoded, index, temp));
    }
    if (!logicalDocuments.length) throw new Error("Nenhum documento legível foi produzido para análise.");
    const result = await runBridge({
      command: "analyze",
      paths: logicalDocuments.map((item) => item.path),
      documents: logicalDocuments.map((item) => ({ path: item.path, provenance: item.provenance })),
      ocr,
    });
    const byStoredName = new Map(logicalDocuments.map((item) => [basename(item.path), item]));
    const sourceFor = (value) => byStoredName.get(basename(String(value || "")));
    const publicEvidence = (evidence) => {
      if (!evidence || typeof evidence !== "object") return evidence;
      const stored = sourceFor(evidence.arquivo);
      if (!stored) return evidence;
      const logicalPage = Number(evidence.pagina || 0);
      const originalPage = logicalPage > 0 ? stored.sourcePages?.[logicalPage - 1] : null;
      return {
        ...evidence,
        arquivo: stored.displayName,
        pagina_documento: logicalPage || null,
        pagina_origem: originalPage || logicalPage || null,
        documento_pje: stored.documentId,
      };
    };
    const publicAnalysis = {
      ...result.analysis,
      documentos: (result.analysis?.documentos || []).map((document) => {
        const stored = sourceFor(document.nome);
        if (!stored) return document;
        return {
          ...document,
          nome: stored.displayName,
          arquivo_original: stored.originalName,
          documento_pje: stored.documentId,
          paginas_origem: stored.sourcePages,
          proveniencia: stored.provenance,
        };
      }),
      achados: Object.fromEntries(Object.entries(result.analysis?.achados || {}).map(([key, finding]) => [
        key,
        { ...finding, evidencias: (finding.evidencias || []).map(publicEvidence) },
      ])),
      // As preliminares também apontam o arquivo pelo nome da cópia temporária;
      // sem este mapeamento a tela mostraria "002-contestacao.txt".
      preliminares: (result.analysis?.preliminares || []).map((item) => (
        item?.evidencia ? { ...item, evidencia: publicEvidence(item.evidencia) } : item
      )),
    };
    const publicSignals = (result.signals || []).map((signal) => {
      const stored = sourceFor(signal.arquivo);
      return stored ? { ...signal, arquivo: stored.displayName, arquivo_original: stored.originalName } : signal;
    });
    const publicCandidate = (candidate) => {
      if (!candidate) return null;
      const stored = sourceFor(candidate.path || candidate.id);
      const { path: _path, ...safeCandidate } = candidate;
      return {
        ...safeCandidate,
        originalName: stored?.displayName || candidate.id,
        sourceOriginalName: stored?.originalName || null,
        sourceDocumentId: stored?.documentId || null,
        sourcePages: stored?.sourcePages || null,
        sourceProvenance: stored?.provenance || null,
        sha256: stored?.sourceSha256 || null,
      };
    };
    const nativeDocumentSelection = result.nativeDocumentSelection ? {
      ...result.nativeDocumentSelection,
      selected: publicCandidate(result.nativeDocumentSelection.selected),
      candidates: (result.nativeDocumentSelection.candidates || []).map(publicCandidate),
    } : null;
    const suppressedChecks = (result.suppressedChecks || []).map((check) => ({
      ...check,
      arquivos: (check.arquivos || []).map((name) => sourceFor(name)?.displayName || name),
    }));
    return {
      ...result,
      analysis: publicAnalysis,
      signals: publicSignals,
      suppressedChecks,
      nativeDocumentSelection,
      custody: {
        originalsModified: false,
        temporaryCopiesDeleted: true,
        documents: manifest,
        preprocessing: {
          logicalDocuments: logicalDocuments.length,
          documents: logicalDocuments.map(({ path: _path, ...item }) => item),
        },
      },
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function buildReplicaDraft(payload) {
  return runBridge({ command: "draft", ...payload });
}

/** Cenários do Caderno de Réplicas (letra e título), para escolha manual. */
export async function listReplicaScenarios() {
  return runBridge({ command: "scenarios" });
}
