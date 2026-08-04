import { describe, it, expect, vi } from "vitest";

/**
 * Caminhos do laudo em que o documento NÃO traz um dado.
 *
 * A separação do § 5 em dois confrontos deixou para trás uma referência a uma
 * variável que passou a viver em outra função. O erro só dispara quando não há
 * geolocalização declarada no documento, porque a condição curto-circuitava
 * antes de chegar nela. Todos os documentos de teste até então traziam
 * coordenada, então três rodadas de verificação passaram por cima.
 *
 * O efeito não era um campo vazio: era `ReferenceError` no meio da geração, ou
 * seja, laudo NENHUM para um contrato sem GPS declarado, que é um caso comum.
 */
vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");

const analise = { id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() };

/** Gera o PDF por inteiro e devolve os bytes, ou lança. */
async function gerar(result) {
  const doc = await buildReportPdf(analise, result);
  const partes = [];
  for await (const p of doc) partes.push(p);
  return Buffer.concat(partes);
}

const base = {
  text: JSON.stringify({ cliente: { nome: "FULANO DE TAL" }, contrato: { banco: "BANCO X" } }),
  metadata: { warnings: [] },
  hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
  file: { name: "contrato.pdf", sizeBytes: 1024 },
  generatedAt: new Date().toISOString(),
  cadeiaCustodia: {
    elementos: [],
    presentes: 0,
    total: 8,
    faltantes: [],
    avaliacao: { rotulo: "INCOMPLETA", tom: "danger", pct: 0, leitura: "x" },
    definicao: "def",
    efeitoProcessual: "efeito",
  },
};

describe("buildReportPdf com dados ausentes", () => {
  it("gera o laudo sem geolocalização declarada, sem IP e sem endereço", async () => {
    // Exatamente o caso que quebrava: um contrato que não registra GPS.
    const pdf = await gerar({ ...base, home: null, contractGeo: null, ipAnalysis: [] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("gera com IP mas sem geolocalização declarada", async () => {
    const pdf = await gerar({
      ...base,
      home: { query: "Rua X", source: "Informado manualmente", geo: { lat: -4.39, lon: -41.6, precision: "manual" } },
      contractGeo: null,
      ipAnalysis: [{ endereco: "189.40.112.87", versao: 4, geo: null, geoFailure: "consulta falhou" }],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("gera com referência e declarado, sem nenhum IP", async () => {
    const pdf = await gerar({
      ...base,
      home: { query: "Rua X", source: "manual", geo: { lat: -4.39, lon: -41.6, precision: "manual" } },
      contractGeo: { lat: -4.4, lon: -41.61, distance: 1.2, divergencia: { km: 1.2, nivel: "compativel", rotulo: "COMPATÍVEL", tom: "ok", sintese: "s", ressalva: null } },
      ipAnalysis: [],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("gera com o result mínimo, sem seção geográfica alguma", async () => {
    const pdf = await gerar({ ...base });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
