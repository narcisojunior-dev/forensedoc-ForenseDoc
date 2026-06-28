import { createWorker } from "tesseract.js";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractPdfText } from "./pdfService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Note: OCR_LANG_PATH is relative to the root backend dir, which is two levels up from this file.
const OCR_LANG_PATH = resolve(__dirname, "../../ocr/lang-data") + "/";
const OCR_LANG = process.env.OCR_LANG || "por+eng";
const OCR_DPI = String(process.env.OCR_DPI || 180);
const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 20);
const PDFTOPPM_CANDIDATES = [
  process.env.PDFTOPPM_PATH,
  "/Users/ronneywellyngton/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm",
  "pdftoppm",
].filter(Boolean);
const execFileAsync = promisify(execFile);

export function needsOcr(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length < 1200) return true;
  return !/(CPF|contrato|proposta|assinatura|trilha|auditoria|banco|benef[ií]cio|valor)/i.test(flat);
}

export async function findPdftoppm() {
  for (const candidate of PDFTOPPM_CANDIDATES) {
    if (!candidate) continue;
    if (candidate.includes("/")) {
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {}
    } else {
      return candidate;
    }
  }
  throw new Error("pdftoppm não encontrado. Configure PDFTOPPM_PATH ou instale Poppler.");
}

export async function extractPdfTextWithOcr(pdfBuffer) {
  const baseText = await extractPdfText(pdfBuffer);
  if (!needsOcr(baseText)) {
    return { text: baseText, usedOcr: false, ocrPages: 0 };
  }

  const pdftoppm = await findPdftoppm();
  const tempDir = await mkdtemp(join(tmpdir(), "forensedoc-ocr-"));
  let worker = null;
  try {
    const pdfPath = join(tempDir, "input.pdf");
    const imagePrefix = join(tempDir, "page");
    await writeFile(pdfPath, pdfBuffer);
    await execFileAsync(
      pdftoppm,
      ["-png", "-r", OCR_DPI, "-f", "1", "-l", String(OCR_MAX_PAGES), pdfPath, imagePrefix],
      { maxBuffer: 1024 * 1024 * 80 },
    );

    const files = (await readdir(tempDir))
      .filter((file) => file.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    worker = await createWorker(OCR_LANG, 1, { langPath: OCR_LANG_PATH });
    let ocrText = "";
    for (const file of files) {
      const { data } = await worker.recognize(join(tempDir, file));
      ocrText += `\n\n--- OCR ${file} ---\n${data.text || ""}`;
    }

    return {
      text: `${baseText}\n\n${ocrText}`.trim(),
      usedOcr: true,
      ocrPages: files.length,
    };
  } finally {
    if (worker) await worker.terminate();
    await rm(tempDir, { recursive: true, force: true });
  }
}
