import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Desenho padrão do laudo.
 *
 * O laudo saiu do desenho em prosa corrida e voltou ao desenho que tinha quando
 * era exportado como imagem pelo navegador: cartões, título de seção em
 * versalete, linha com o valor à direita e selos em pílula. A diferença é que
 * agora ele é vetor, feito pelo PDFKit no servidor.
 *
 * O que este teste tranca é o que a mudança de desenho pode quebrar sem avisar:
 * a camada de texto. Versalete espaçado demais faz o extrator inserir um espaço
 * entre cada letra, e um laudo que não é pesquisável perde serventia nos autos.
 */

vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
  mapPointsDeclaredVsIp: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { buildSummaryForResult } = await import("../src/services/analysisRecompute.js");
const { buildCustodyChain } = await import("../src/reports/custodyChain.js");
const { extractPdfTextDetailed } = await import("../src/services/pdfService.js");

async function laudo(opcoes) {
  const caso = JSON.parse(await readFile(new URL("./corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
  const extracted = heuristicExtractionFromText(caso.texto);
  const result = {
    text: JSON.stringify(extracted),
    metadata: { warnings: [] },
    reportId: "FD-20260919-TEMA000000",
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    file: { name: "dossie.pdf", sizeBytes: 1_000_000 },
    generatedAt: new Date().toISOString(),
    home: null,
    contractGeo: null,
    ipAnalysis: [],
    cadeiaCustodia: buildCustodyChain(extracted, [], false),
  };
  result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
  const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result, opcoes);
  const partes = [];
  for await (const parte of doc) partes.push(parte);
  const { text } = await extractPdfTextDetailed(Buffer.concat(partes));
  return text;
}

describe("desenho padrão do laudo", () => {
  it("sai no tema do modelo, com capa, cabeçalho e rodapé próprios", async () => {
    const texto = (await laudo()).replace(/\s+/g, " ");
    expect(texto).toContain("LAUDO TÉCNICO PERICIAL · CADEIA DE CUSTÓDIA");
    expect(texto).toContain("PROTOCOLO TÉCNICO");
    expect(texto).toContain("FORENSEDOC | LAUDO TÉCNICO PERICIAL");
    expect(texto).toContain("Documento gerado pelo ForenseDoc");
    expect(texto).toMatch(/Página 1 de \d+/);
    // Título de seção em versalete, sem dois-pontos entre rótulo e valor.
    expect(texto).toContain("§ 1 · IDENTIFICAÇÃO E INTEGRIDADE CRIPTOGRÁFICA");
    expect(texto).toMatch(/Nome do arquivo\s+dossie\.pdf/);
  });

  it("mantém a camada de texto pesquisável, sem letra separada por espaço", async () => {
    const texto = await laudo();
    for (const titulo of [
      "LAUDO TÉCNICO PERICIAL · CADEIA DE CUSTÓDIA",
      "§ 5.1 · CONFRONTO 1 · ORIGEM DA CONEXÃO (IP) × RESIDÊNCIA INFORMADA",
      "PLACAR DE GRAVIDADE",
      "DILIGÊNCIAS RECOMENDADAS",
    ]) {
      expect(texto, titulo).toContain(titulo);
    }
    // A assinatura do defeito: "A C H A D O S" no lugar de "ACHADOS".
    expect(texto).not.toMatch(/(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ] ){5,}/);
  });

  it("o desenho anterior continua disponível para comparação", async () => {
    const texto = (await laudo({ tema: "classico" })).replace(/\s+/g, " ");
    expect(texto).toContain("Laudo Técnico Pericial");
    expect(texto).toContain("§ 1 · Identificação e integridade criptográfica");
    expect(texto).toMatch(/Nome do arquivo:\s+dossie\.pdf/);
  });
});
