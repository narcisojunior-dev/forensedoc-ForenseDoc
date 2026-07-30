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

/**
 * ─── O orçamento de tempo precisa caber no trabalho prometido ────────────────
 *
 * Medição sobre dossiê real, a 180 DPI: rasterização de 529 ms por página e OCR
 * de aproximadamente 5 segundos por página. Com `OCR_MAX_PAGES=20`, o custo
 * projetado é de cerca de 112 segundos.
 *
 * O timeout era fixo em 60 segundos. Os dois valores eram incompatíveis entre
 * si: o sistema aceitava 20 páginas e desistia por volta da 11ª, e o cliente
 * recebia "não foi possível processar seu documento" com o crédito estornado.
 * Documentos escaneados são justamente os que os bancos entregam, então o caso
 * que falhava era o caso comum.
 *
 * O default agora DERIVA do número de páginas, com folga para máquina mais lenta
 * que a de medição e um piso para documentos curtos. Continua sobrescrevível por
 * `OCR_TIMEOUT_MS` quando a infraestrutura exigir outro valor.
 */
const CUSTO_ESTIMADO_POR_PAGINA_MS = 6_000; // 5s de OCR + 0,5s de raster + folga

/**
 * Orçamento de tempo do OCR, em milissegundos.
 *
 * Exportado porque o TTL do mutex de análise precisa do MESMO número: se o lock
 * expirar antes do pior caso de processamento, um segundo job do mesmo tenant
 * entra enquanto o primeiro ainda roda. Duplicar a regra nos dois lugares faria
 * os dois valores divergirem no primeiro ajuste de `OCR_MAX_PAGES`.
 */
export function ocrBudgetMs() {
  return (
    Number(process.env.OCR_TIMEOUT_MS) ||
    Math.max(60_000, OCR_MAX_PAGES * CUSTO_ESTIMADO_POR_PAGINA_MS)
  );
}

const OCR_TIMEOUT_MS = ocrBudgetMs();
const PDFTOPPM_CANDIDATES = [
  process.env.PDFTOPPM_PATH,
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

  /*
   * `Promise.race` sozinho não cancela nada: ele resolve a promessa externa e
   * deixa o Tesseract rodando até terminar por conta própria. Sob carga isso
   * significa CPU queimada com trabalho cujo resultado já foi descartado,
   * atrasando os jobs seguintes da fila de análise.
   *
   * O objeto `controle` fecha esse buraco por dois caminhos: encerra o worker do
   * Tesseract assim que o prazo estoura, e marca a flag que faz o laço de
   * páginas parar em vez de seguir processando o documento inteiro.
   */
  const controle = { cancelado: false, worker: null };
  let timer;

  const prazo = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controle.cancelado = true;
      Promise.resolve(controle.worker?.terminate()).catch(() => {});
      reject(new Error(`OCR timeout após ${OCR_TIMEOUT_MS}ms`));
    }, OCR_TIMEOUT_MS);
  });

  try {
    return await Promise.race([runOcr(baseText, pdfBuffer, controle), prazo]);
  } finally {
    clearTimeout(timer);
    controle.cancelado = true;
  }
}

async function runOcr(baseText, pdfBuffer, controle = { cancelado: false }) {
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
    controle.worker = worker;

    let ocrText = "";
    for (const file of files) {
      // O prazo pode ter estourado durante a página anterior. Continuar aqui
      // seria processar um documento inteiro cujo resultado já foi rejeitado.
      if (controle.cancelado) break;
      const { data } = await worker.recognize(join(tempDir, file));
      ocrText += `\n\n--- OCR ${file} ---\n${data.text || ""}`;
    }

    return {
      text: `${baseText}\n\n${ocrText}`.trim(),
      usedOcr: true,
      ocrPages: files.length,
    };
  } finally {
    // O timeout pode já ter encerrado este worker; encerrar de novo lança, e a
    // exceção aqui mascararia o erro real que levou o fluxo até o `finally`.
    if (worker) await Promise.resolve(worker.terminate()).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  }
}
