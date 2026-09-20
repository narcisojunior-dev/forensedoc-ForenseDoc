import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Bloco de verificação pública dentro do laudo.
 *
 * O que este teste tranca é a CAMADA DE TEXTO do bloco. O QR sozinho não basta:
 * ele depende de câmera e de conexão, e quem está com o laudo impresso num
 * cartório sem sinal precisa poder digitar o código. Se o código e o hash
 * deixarem de ser extraíveis do PDF, o caminho alternativo some sem avisar.
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
  return text.replace(/\s+/g, " ");
}

const VERIFICACAO = { codigo: "FD-7KQ2-9XMR-4TVB", laudoHash: "C".repeat(64) };

describe("bloco de verificação no laudo", () => {
  it("imprime o código de verificação de forma legível pelo extrator", async () => {
    const texto = await laudo({ verificacao: VERIFICACAO });
    expect(texto).toContain("FD-7KQ2-9XMR-4TVB");
  });

  it("imprime o SHA-256 do laudo, que é o que se cola na busca", async () => {
    const texto = await laudo({ verificacao: VERIFICACAO });
    expect(texto).toContain("C".repeat(64));
  });

  it("traz o endereço da página, para quem não pode usar a câmera", async () => {
    const texto = await laudo({ verificacao: VERIFICACAO });
    expect(texto.toLowerCase()).toContain("/verificar");
  });

  it("explica que a conferência é do conteúdo e não do arquivo", async () => {
    const texto = await laudo({ verificacao: VERIFICACAO });
    expect(texto).toMatch(/confere o CONTE(Ú|U)DO do laudo, n(ã|a)o o arquivo/i);
  });

  it("sai igual nos dois temas, porque o bloco vive fora da capa", async () => {
    const modelo = await laudo({ verificacao: VERIFICACAO });
    const classico = await laudo({ verificacao: VERIFICACAO, tema: "classico" });
    expect(modelo).toContain("FD-7KQ2-9XMR-4TVB");
    expect(classico).toContain("FD-7KQ2-9XMR-4TVB");
  });

  it("laudo antigo, sem registro de verificação, sai sem o bloco em vez de falhar", async () => {
    const texto = await laudo({});
    expect(texto).not.toContain("FD-7KQ2-9XMR-4TVB");
    expect(texto).not.toMatch(/Verifica(ç|c)(ã|a)o de autenticidade/i);
  });
});
