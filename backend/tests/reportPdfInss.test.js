import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
  mapPointsDeclaredVsIp: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { TEXTO_GOVBR } = await import("./helpers/textoInss.js");

async function textoDoPdf(extracted) {
  const result = {
    text: JSON.stringify(extracted),
    metadata: { version: "1.7", totalPages: 1, warnings: [] },
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    ipAnalysis: [],
  };
  const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result);
  const partes = [];
  for await (const p of doc) partes.push(p);
  const parser = new PDFParse({ data: Buffer.concat(partes) });
  try {
    return (await parser.getText()).text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

describe("PDF: autorização do benefício (INSS)", () => {
  it("traz regime, via, ofício e ressalva de vigência", async () => {
    const texto = await textoDoPdf(heuristicExtractionFromText(TEXTO_GOVBR));
    expect(texto).toMatch(/Autorização do benefício \(INSS\)/i);
    expect(texto).toMatch(/Conta gov\.br com validação dos dados bancários/);
    expect(texto).toMatch(/requisitado por ofício/);
    expect(texto).toMatch(/não foi conferido no Diário Oficial/);
  });

  it("dossiê C6 (CLT) não ganha a seção", async () => {
    const caso = JSON.parse(await readFile(new URL("./corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
    const texto = await textoDoPdf(heuristicExtractionFromText(caso.texto));
    expect(texto).not.toMatch(/Autorização do benefício \(INSS\)/i);
  });
});
