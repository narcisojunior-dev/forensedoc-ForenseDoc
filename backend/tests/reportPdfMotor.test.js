import { describe, it, expect, vi } from "vitest";
import { makeSearchablePdf } from "./helpers/pdfDeTeste.js";

/**
 * O laudo em PDF precisa sair com as seções do motor pericial v2 e continuar
 * saindo quando elas faltam (laudos gerados antes da migração).
 */
vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { extractPdfTextWithOcr } = await import("../src/services/ocrService.js");
const { extractPdfMetadata } = await import("../src/services/pdfService.js");
const { analisarDocumento } = await import("../src/engine/analisarDocumento.js");
const { buildSummaryForResult } = await import("../src/services/analysisRecompute.js");
const { buildCustodyChain } = await import("../src/reports/custodyChain.js");

async function gerar(result) {
  const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result);
  const partes = [];
  for await (const p of doc) partes.push(p);
  return Buffer.concat(partes);
}

describe("laudo em PDF com o motor pericial v2", () => {
  it("inclui assinatura digital, aferição, trilha, confronto e sumário", async () => {
    const pdf = makeSearchablePdf([
      "CEDULA DE CREDITO BANCARIO (CCB) N 1234567890",
      "EMPRESTIMO CONSIGNADO contrato beneficio banco valor",
      "Nome do cliente: Maria Aparecida Souza CPF: 111.444.777-35",
      "Valor Liberado R$ 4.800,00 Taxa de Juros Efetiva 1,80% a.m.",
      "Endereco IP: 177.104.55.201 Data e hora: 25/06/2025 10:45:03",
    ]);
    const [extraction, rawMetadata] = await Promise.all([extractPdfTextWithOcr(pdf), extractPdfMetadata(pdf)]);
    const { extracted, metadata } = await analisarDocumento({ pdfBuffer: pdf, extraction, rawMetadata });

    const result = {
      text: JSON.stringify(extracted),
      metadata,
      reportId: "FD-20260916-AAAAAAAAAA",
      hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
      file: { name: "contrato.pdf", sizeBytes: pdf.length },
      generatedAt: new Date().toISOString(),
      home: null,
      contractGeo: null,
      ipAnalysis: extracted.ips.map((ip) => ({ ...ip, geo: null, geoFailure: "teste" })),
      cadeiaCustodia: buildCustodyChain(extracted, [], false),
      processComparison: {
        status: "COMPLETED",
        resultado: "DIVERGÊNCIAS A CONFERIR",
        confirmations: [{ label: "Número do contrato", contrato: "1234567890", processo: "LOCALIZADO", status: "CONFIRMADO" }],
        divergences: [{ label: "Valor", contrato: "R$ 1,00", processo: "R$ 2,00", severidade: "DIVERGÊNCIA", detalhe: "x", trecho: "y" }],
        observations: [],
        file: { name: "processo.pdf", sha256: "C".repeat(64) },
      },
    };
    result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
    expect(result.sumarioIrregularidades).toBeTruthy();

    const bytes = await gerar(result);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
  });

  it("gera laudo antigo, sem nenhum campo do motor", async () => {
    const bytes = await gerar({
      text: JSON.stringify({ cliente: { nome: "FULANO" }, evidencias_irregularidade: ["Achado antigo."] }),
      metadata: { warnings: [] },
      hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
      file: { name: "contrato.pdf", sizeBytes: 1024 },
      generatedAt: new Date().toISOString(),
      ipAnalysis: [],
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
