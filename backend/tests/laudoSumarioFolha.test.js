import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Folha do sumário executivo dentro do PDF.
 *
 * O conteúdo do sumário já saía no laudo, mas como mais uma seção corrida, sem
 * o cabeçalho que o identifica. Na tela ele é uma peça destacável, com marca,
 * etiqueta e a linha de banco, contrato e CPF, e é por esse cabeçalho que o
 * operador o procura. Sem ele, quem folheia o PDF não reconhece o bloco e
 * conclui que o sumário não foi impresso.
 *
 * O teste tranca o cabeçalho, não o conteúdo: o conteúdo já tem cobertura em
 * laudoTemaModelo e laudoSemValoresEconomicos.
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

async function laudo(opcoes = {}) {
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
  return { texto: text.replace(/\s+/g, " "), sumario: result.sumarioIrregularidades };
}

describe("folha do sumário executivo no PDF", () => {
  it("abre com a marca e a linha de verificação de cadeia de custódia", async () => {
    const { texto } = await laudo();
    expect(texto).toMatch(/VERIFICA(Ç|C)(Ã|A)O DE CADEIA DE CUST(Ó|O)DIA DOCUMENTAL/i);
  });

  it("traz a etiqueta SUMÁRIO EXECUTIVO e o número do laudo no cabeçalho", async () => {
    const { texto } = await laudo();
    expect(texto).toMatch(/SUM(Á|A)RIO EXECUTIVO/i);
    expect(texto).toContain("FD-20260919-TEMA000000");
  });

  it("identifica banco, contrato e CPF na mesma linha, como na tela", async () => {
    const { texto, sumario } = await laudo();
    // É por esta linha que o operador confere que está olhando o laudo certo.
    expect(texto).toContain(sumario.bank);
    expect(texto).toContain(sumario.contractNumber);
    expect(texto).toContain(sumario.cpf);
  });

  it("traz o título do bloco", async () => {
    const { texto } = await laudo();
    expect(texto).toMatch(/Irregularidades do laudo ForenseDoc, em s(í|i)ntese/i);
  });

  it("não repete banco e CPF como linhas soltas abaixo do cabeçalho", async () => {
    // Antes do cabeçalho existir, os dois eram impressos como campos. Mantê-los
    // depois de a folha ganhar cabeçalho duplicaria a mesma informação.
    const { texto } = await laudo();
    expect(texto).not.toContain("Instituição / contrato");
  });

  it("sai também no tema clássico", async () => {
    const { texto } = await laudo({ tema: "classico" });
    expect(texto).toMatch(/VERIFICA(Ç|C)(Ã|A)O DE CADEIA DE CUST(Ó|O)DIA DOCUMENTAL/i);
    expect(texto).toMatch(/Irregularidades do laudo ForenseDoc, em s(í|i)ntese/i);
  });
});
