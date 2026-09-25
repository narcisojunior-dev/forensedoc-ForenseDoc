import { describe, it, expect } from "vitest";
import { buildIrregularitySummary } from "../../src/engine/irregularitySummary.js";

function relatorio(extracted) {
  return {
    reportId: "FD-TESTE-INSS",
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    metadata: { totalPages: 2, warnings: [] },
    extracted: {
      contrato: { numero: "123", banco: "Banco Exemplo", data_contrato: "15/03/2025", produto_codigo: "CONSIGNADO_INSS" },
      cliente: { nome: "Maria Aparecida Souza", cidade: "Teresina", estado: "PI" },
      assinatura: {},
      ...extracted,
    },
    ipAnalysis: [],
  };
}

describe("sumário: autorização INSS", () => {
  it("correspondente de outra UF no regime da IN 138 aponta INS1", () => {
    const s = buildIrregularitySummary(relatorio({
      correspondente: { cidade: "São Paulo", uf: "SP" },
      regime_inss: { codigo: "IN_138_SELFIE_BANCO", diligencias: [] },
    }));
    const ins1 = s.allFindings.find((f) => f.key === "INS1");
    expect(ins1.severity).toBe("ALTA");
    expect(ins1.text).toMatch(/São Paulo\/SP/);
    expect(ins1.text).not.toMatch(/art\. 5º, VIII/);
  });

  it("mesma UF não aponta INS1", () => {
    const s = buildIrregularitySummary(relatorio({
      correspondente: { cidade: "Parnaíba", uf: "PI" },
      regime_inss: { codigo: "IN_138_SELFIE_BANCO", diligencias: [] },
    }));
    expect(s.allFindings.some((f) => f.key === "INS1")).toBe(false);
  });

  it("contrato sob a IN 28/2008 não recebe INS1", () => {
    const s = buildIrregularitySummary(relatorio({
      correspondente: { cidade: "São Paulo", uf: "SP" },
      regime_inss: { codigo: "IN_28_2008", diligencias: [] },
    }));
    expect(s.allFindings.some((f) => f.key === "INS1")).toBe(false);
  });

  it("diligências do regime entram no sumário", () => {
    const s = buildIrregularitySummary(relatorio({
      regime_inss: { codigo: "MEU_INSS_BIOMETRIA", diligencias: [{ chave: "oficio-inss-dataprev", titulo: "Ofício ao INSS e à Dataprev", texto: "Requisitar o registro." }] },
    }));
    expect(s.diligences.some((d) => d.key === "oficio-inss-dataprev")).toBe(true);
  });
});
