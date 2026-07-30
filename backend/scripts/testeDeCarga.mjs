/**
 * Teste de carga do pipeline de análise.
 *
 * ─── Por que com PDF escaneado ───────────────────────────────────────────────
 *
 * Todo dimensionamento anterior partiu de projeção: cinco páginas medidas,
 * extrapoladas para vinte. Documento digital custa menos de um segundo;
 * escaneado custa ordens de grandeza mais, e é o que os bancos entregam. Medir
 * carga só com o caso fácil não diz nada sobre o pior.
 *
 * O roteiro executa o MESMO pipeline do worker (extração, OCR, geolocalização,
 * cadeia de custódia), sem fila e sem banco, variando a concorrência. O que se
 * quer descobrir é onde a vazão para de crescer, que é o valor certo de
 * WORKER_CONCURRENCY_ANALYSIS para o host.
 *
 *   node scripts/testeDeCarga.mjs <arquivo.pdf> [concorrências] [repetições]
 *   node scripts/testeDeCarga.mjs /tmp/escaneado.pdf 1,2,4,6 2
 */
import "dotenv/config";
import os from "node:os";
import v8 from "node:v8";
import fs from "node:fs/promises";

const [arquivo, listaConc = "1,2,4", repeticoes = "1"] = process.argv.slice(2);
if (!arquivo) {
  console.error("uso: node scripts/testeDeCarga.mjs <arquivo.pdf> [concorrências] [repetições]");
  process.exit(1);
}

const { extractPdfTextWithOcr } = await import("../src/services/ocrService.js");
const { extractPdfMetadata } = await import("../src/services/pdfService.js");
const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { enrichGeography } = await import("../src/services/geoEnrichmentService.js");
const { buildCustodyChain } = await import("../src/reports/custodyChain.js");

const pdf = await fs.readFile(arquivo);
const HOME = "Rua Solimões, S/N, Areal, Manaquiri, Amazonas";
const COORD = { lat: -3.434452, lon: -60.4725532 };

/** Uma análise completa, igual à do worker. */
async function analisar() {
  const t0 = Date.now();
  const [extracao, metadados] = await Promise.all([
    extractPdfTextWithOcr(pdf),
    extractPdfMetadata(pdf),
  ]);
  const extraido = heuristicExtractionFromText(extracao.text);
  const geo = await enrichGeography(extraido, HOME, COORD);
  buildCustodyChain(extraido, geo.ipAnalysis, geo.geoDeclaredPresent);
  return { ms: Date.now() - t0, ocr: extracao.usedOcr, paginas: extracao.ocrPages };
}

const mb = (b) => (b / 1024 / 1024).toFixed(0);
const pct = (v, p) => {
  const ord = [...v].sort((a, b) => a - b);
  return ord[Math.min(ord.length - 1, Math.floor((ord.length * p) / 100))];
};

console.log(`arquivo   ${arquivo} (${mb(pdf.length)} MB)`);
console.log(`host      ${os.cpus().length} núcleos, ${mb(os.totalmem())} MB de RAM`);
console.log(`heap      limite de ${mb(v8.getHeapStatistics().heap_size_limit)} MB\n`);

console.log("conc  amostras  mediana   p95     vazão      pico heap   obs");
console.log("─".repeat(78));

let melhorVazao = 0;
let melhorConc = 1;

for (const c of listaConc.split(",").map(Number)) {
  const duracoes = [];
  let picoHeap = 0;
  let erros = 0;
  const t0 = Date.now();

  for (let r = 0; r < Number(repeticoes); r++) {
    const resultados = await Promise.allSettled(Array.from({ length: c }, analisar));
    for (const res of resultados) {
      if (res.status === "fulfilled") duracoes.push(res.value.ms);
      else erros++;
    }
    picoHeap = Math.max(picoHeap, process.memoryUsage().heapUsed);
  }

  const totalMs = Date.now() - t0;
  const vazao = (duracoes.length / (totalMs / 1000)) * 60; // análises por minuto
  if (vazao > melhorVazao) {
    melhorVazao = vazao;
    melhorConc = c;
  }

  console.log(
    `${String(c).padStart(4)}  ${String(duracoes.length).padStart(8)}  ` +
      `${String((pct(duracoes, 50) / 1000).toFixed(1) + "s").padStart(7)}  ` +
      `${String((pct(duracoes, 95) / 1000).toFixed(1) + "s").padStart(6)}  ` +
      `${String(vazao.toFixed(1) + "/min").padStart(9)}  ` +
      `${String(mb(picoHeap) + " MB").padStart(9)}   ${erros ? `${erros} erro(s)` : ""}`
  );
}

console.log("─".repeat(78));
console.log(`\nMelhor vazão: ${melhorVazao.toFixed(1)}/min com concorrência ${melhorConc}.`);
console.log(
  "A vazão parar de crescer indica saturação de CPU: acima disso, aumentar a\n" +
    "concorrência só aumenta a latência de cada análise. Escale por RÉPLICA a partir daí."
);
process.exit(0);
