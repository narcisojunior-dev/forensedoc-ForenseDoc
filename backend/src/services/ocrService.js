import { createWorker } from "tesseract.js";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractPdfTextDetailed } from "./pdfService.js";

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
 *
 * ─── O primeiro valor não tinha margem, e o teste de carga provou ────────────
 *
 * A estimativa inicial era 6 s por página, tirada da MÉDIA de cinco páginas. Com
 * 20 páginas isso dava 120 s de orçamento, e o teste de carga com documento
 * escaneado real (scripts/testeDeCarga.mjs) mediu 105,3 s numa execução e
 * ESTOUROU o prazo em outra, com a mesma carga na mesma máquina.
 *
 * O erro foi dimensionar pela média: um prazo colocado sobre a média falha
 * metade das vezes por definição, e a falha aqui não é um retry, é o crédito
 * estornado com "não foi possível processar seu documento".
 *
 * 9 s por página dá cerca de 70% de folga sobre a média medida. A margem também
 * cobre a diferença de hardware: a medição saiu numa máquina de desenvolvimento
 * com 10 núcleos, e o servidor de produção tende a ser mais lento, além de estar
 * processando outras análises ao mesmo tempo.
 */
const CUSTO_ESTIMADO_POR_PAGINA_MS = Number(process.env.OCR_COST_PER_PAGE_MS) || 9_000;

/*
 * ─── Releitura de alta precisão das páginas finais ──────────────────────────
 *
 * Motor pericial v2: dossiês de contratação trazem a trilha de auditoria (IP,
 * porta, carimbo de tempo, GPS) nas duas últimas páginas, em fonte pequena. A
 * 180 DPI o Tesseract confunde dígitos justamente ali, e um octeto errado muda
 * a geolocalização do ato. Essas páginas são lidas de novo a 240 DPI ou mais.
 *
 * A 240 DPI cada página tem cerca de 1,8x os pixels da leitura normal, e é esse
 * o peso de cada página relida no orçamento de tempo. Nunca se relê mais páginas
 * do que o documento tem.
 */
const PAGINAS_DE_REFINAMENTO = 2;
const OCR_REFINE_DPI = String(Math.max(240, Number(process.env.OCR_DPI || 180)));
const CUSTO_EQUIVALENTE_DO_REFINAMENTO = Math.min(PAGINAS_DE_REFINAMENTO, OCR_MAX_PAGES) * 1.8;

/*
 * ─── O orçamento precisa contar a disputa por CPU ────────────────────────────
 *
 * Corrigir a estimativa por página não bastou. O prazo é tempo de RELÓGIO, mas a
 * duração de uma análise depende de quantas outras rodam ao mesmo tempo, porque
 * o OCR é limitado por CPU. A curva de saturação mostrou isso:
 *
 *   concorrência   mediana    sobre a de 1
 *    1              99,0 s     1,00x
 *    2             109,4 s     1,11x
 *    4             175,6 s     1,77x
 *    6             TODAS falharam por estouro de prazo
 *
 * Com prazo fixo de 180 s, a concorrência 4 (que é o DEFAULT do worker) já
 * entregava mediana de 175,6 s: metade das análises falharia sob carga
 * sustentada. E a concorrência 6 não entregava nenhuma.
 *
 * A raiz quadrada da concorrência acompanha bem a curva medida (2,00 contra
 * 1,77x observado em 4) e ainda deixa margem. Não é lei física; é ajuste ao que
 * foi medido, e por isso o valor continua sobrescrevível.
 *
 * O ponto conceitual: este prazo existe para capturar caso patológico (PDF
 * corrompido, Tesseract travado), NÃO para impor tempo de resposta. Um prazo que
 * dispara sob carga legítima está fazendo o trabalho errado, e o preço é o
 * crédito do cliente sendo estornado por um laudo que ia sair.
 */
function fatorContencao() {
  const conc = Math.max(1, Number(process.env.WORKER_CONCURRENCY_ANALYSIS) || 4);
  return Math.sqrt(conc);
}

/**
 * Orçamento de tempo do OCR, em milissegundos.
 *
 * Exportado porque o TTL do mutex de análise precisa do MESMO número: se o lock
 * expirar antes do pior caso de processamento, um segundo job do mesmo tenant
 * entra enquanto o primeiro ainda roda. Duplicar a regra nos dois lugares faria
 * os dois valores divergirem no primeiro ajuste de `OCR_MAX_PAGES`.
 */
export function ocrBudgetMs() {
  const paginas = OCR_MAX_PAGES + CUSTO_EQUIVALENTE_DO_REFINAMENTO;
  return (
    Number(process.env.OCR_TIMEOUT_MS) ||
    Math.max(60_000, Math.round(paginas * CUSTO_ESTIMADO_POR_PAGINA_MS * fatorContencao()))
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

/**
 * Faixas de páginas para OCR.
 *
 * Com mais páginas que `OCR_MAX_PAGES`, ler só as primeiras deixava de fora o
 * fim do documento, que é onde ficam a trilha de auditoria e o termo de aceite.
 * O motor pericial divide o orçamento: 60% no início (qualificação e quadro da
 * operação) e 40% no fim (assinatura e trilha).
 */
export function faixasDeOcr(totalPaginas, maxPaginas = OCR_MAX_PAGES) {
  const total = Math.max(1, Number(totalPaginas) || maxPaginas);
  if (total <= maxPaginas) return [[1, total]];
  const inicio = Math.ceil(maxPaginas * 0.6);
  const fim = maxPaginas - inicio;
  return fim > 0 ? [[1, inicio], [total - fim + 1, total]] : [[1, inicio]];
}

export async function extractPdfTextWithOcr(pdfBuffer) {
  const extraido = await extractPdfTextDetailed(pdfBuffer);
  const baseText = extraido.text;
  if (!needsOcr(baseText)) {
    return { text: baseText, usedOcr: false, ocrPages: 0, ocrPageNumbers: [], ocrRefinementPages: [] };
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
    return await Promise.race([runOcr(baseText, pdfBuffer, extraido.totalPages, controle), prazo]);
  } finally {
    clearTimeout(timer);
    controle.cancelado = true;
  }
}

async function runOcr(baseText, pdfBuffer, totalPaginas, controle = { cancelado: false }) {
  const pdftoppm = await findPdftoppm();
  const tempDir = await mkdtemp(join(tmpdir(), "forensedoc-ocr-"));
  let worker = null;
  try {
    const pdfPath = join(tempDir, "input.pdf");
    const imagePrefix = join(tempDir, "page");
    const refinePrefix = join(tempDir, "audit-page");
    await writeFile(pdfPath, pdfBuffer);
    const total = Math.max(1, Number(totalPaginas) || OCR_MAX_PAGES);
    for (const [primeira, ultima] of faixasDeOcr(total)) {
      if (controle.cancelado) break;
      await execFileAsync(
        pdftoppm,
        ["-png", "-r", OCR_DPI, "-f", String(primeira), "-l", String(ultima), pdfPath, imagePrefix],
        { maxBuffer: 1024 * 1024 * 80 },
      );
    }
    if (!controle.cancelado) {
      await execFileAsync(
        pdftoppm,
        ["-png", "-r", OCR_REFINE_DPI, "-f", String(Math.max(1, total - PAGINAS_DE_REFINAMENTO + 1)), "-l", String(total), pdfPath, refinePrefix],
        { maxBuffer: 1024 * 1024 * 80 },
      );
    }

    const renderizados = await readdir(tempDir);
    const ordenar = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    const files = renderizados.filter((file) => /^page-\d+\.png$/.test(file)).sort(ordenar);
    const refineFiles = renderizados.filter((file) => /^audit-page-\d+\.png$/.test(file)).sort(ordenar);
    const numeroDaPagina = (file) => Number(file.match(/(\d+)\.png$/)?.[1]);

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
    for (const file of refineFiles) {
      if (controle.cancelado) break;
      const { data } = await worker.recognize(join(tempDir, file));
      ocrText += `\n\n--- OCR ${file} ---\n${data.text || ""}`;
    }

    return {
      text: `${baseText}\n\n${ocrText}`.trim(),
      usedOcr: true,
      ocrPages: files.length,
      ocrPageNumbers: files.map(numeroDaPagina).filter(Number.isFinite),
      ocrRefinementPages: refineFiles.map(numeroDaPagina).filter(Number.isFinite),
    };
  } finally {
    // O timeout pode já ter encerrado este worker; encerrar de novo lança, e a
    // exceção aqui mascararia o erro real que levou o fluxo até o `finally`.
    if (worker) await Promise.resolve(worker.terminate()).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  }
}
