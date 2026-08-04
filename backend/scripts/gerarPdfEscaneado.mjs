/**
 * Gera um PDF SEM camada de texto a partir de um PDF normal, para exercitar o
 * caminho de OCR em teste de carga.
 *
 * Os documentos que os bancos entregam são digitalizações, e é justamente o
 * caminho caro: medições anteriores davam ~5 s de OCR por página contra ~0,7 s
 * para o documento inteiro quando há camada de texto. Testar carga só com PDF
 * digital mede o caso fácil e não diz nada sobre o pior.
 *
 *   node scripts/gerarPdfEscaneado.mjs <entrada.pdf> <saida.pdf> [paginas]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import PDFDocument from "pdfkit";

const exec = promisify(execFile);
const [entrada, saida, paginas = "20"] = process.argv.slice(2);

if (!entrada || !saida) {
  console.error("uso: node scripts/gerarPdfEscaneado.mjs <entrada.pdf> <saida.pdf> [paginas]");
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), "escaneado-"));
try {
  // 150 DPI: resolução de digitalização comum, e o suficiente para o OCR ter
  // trabalho real sem inflar o arquivo além do que um scanner produziria.
  await exec("pdftoppm", ["-png", "-r", "150", "-f", "1", "-l", paginas, entrada, join(dir, "p")], {
    maxBuffer: 1024 * 1024 * 200,
  });

  const imagens = (await readdir(dir))
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const doc = new PDFDocument({ autoFirstPage: false });
  const stream = createWriteStream(saida);
  doc.pipe(stream);

  for (const img of imagens) {
    doc.addPage({ size: "A4", margin: 0 });
    doc.image(join(dir, img), 0, 0, { fit: [595.28, 841.89], align: "center", valign: "center" });
  }

  doc.end();
  await new Promise((r) => stream.on("finish", r));
  console.log(`${imagens.length} página(s) rasterizada(s) em ${saida}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
