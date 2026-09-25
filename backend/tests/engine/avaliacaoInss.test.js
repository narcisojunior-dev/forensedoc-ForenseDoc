import { describe, it, expect } from "vitest";
import { avaliarAutorizacaoInss } from "../../src/engine/avaliacaoInss.js";
import { extrairEvidenciasAutorizacao } from "../../src/engine/evidenciasAutorizacao.js";
import { DISPOSITIVOS_IN138 } from "../../src/engine/regimeInss.js";

const codigos = (r) => r.achados.map((a) => a.codigo);
const avaliar = (regime, texto, extra = {}) => avaliarAutorizacaoInss({ regime, evidencias: extrairEvidenciasAutorizacao(texto), ...extra });

const IN138 = { codigo: "IN_138_SELFIE_BANCO", rotulo: "Selfie colhida e guardada pela instituição", data_contrato: "15/03/2025", via: null };
const MEU_INSS = { codigo: "MEU_INSS_BIOMETRIA", rotulo: "Autorização no Meu INSS com biometria facial e validação de vivacidade", data_contrato: "10/06/2026", via: "FACIAL" };
const COMPLETO = "Autorização no Meu INSS em 10/06/2026 às 14:32:10 por biometria facial com prova de vivacidade, confronto com a CNH. Demonstrativo prévio anexo.";

describe("autorização INSS: regimes IN 138 e Meu INSS", () => {
  it("fora do consignado INSS não avalia nada", () => {
    expect(avaliar(null, "")).toEqual({ achados: [], diligencias: [] });
  });

  it("sem data do contrato aponta INS0 e para", () => {
    expect(codigos(avaliar({ codigo: "INDETERMINADO" }, ""))).toEqual(["INS0"]);
  });

  it("contrato sob a IN 28/2008 não recebe exigências da IN 138", () => {
    expect(avaliar({ codigo: "IN_28_2008", data_contrato: "10/05/2021" }, "").achados).toEqual([]);
  });

  it("regime 138 sem demonstrativo prévio, com o dispositivo ainda não conferido, vira diligência e não achado", () => {
    const r = avaliar(IN138, "Contrato sem anexos");
    expect(codigos(r)).toEqual([]);
    expect(r.diligencias.map((d) => d.chave)).toEqual(["demonstrativo-previo"]);
    expect(r.diligencias[0].texto).not.toMatch(/§ 9º/);
  });

  it("com o dispositivo conferido, INS2 sai como achado citando o artigo", () => {
    const antes = DISPOSITIVOS_IN138.DEMONSTRATIVO_PREVIO.conferido;
    DISPOSITIVOS_IN138.DEMONSTRATIVO_PREVIO.conferido = true;
    try {
      const r = avaliar(IN138, "Contrato sem anexos");
      expect(codigos(r)).toEqual(["INS2"]);
      expect(r.achados[0].texto).toMatch(/art\. 5º, § 9º, da IN PRES\/INSS nº 138\/2022/);
      expect(r.diligencias).toEqual([]);
    } finally {
      DISPOSITIVOS_IN138.DEMONSTRATIVO_PREVIO.conferido = antes;
    }
  });

  it("regime Meu INSS sem registro da autorização aponta INS3 e pede ofício", () => {
    const r = avaliar(MEU_INSS, "Selfie colhida pelo banco. Demonstrativo prévio anexo.");
    expect(codigos(r)).toContain("INS3");
    expect(r.achados.find((a) => a.codigo === "INS3").texto).toMatch(/não a fotografia colhida pela instituição/);
    expect(r.diligencias.map((d) => d.chave)).toContain("oficio-inss-dataprev");
  });

  it("registro completo da autorização não gera INS3, mas mantém o ofício", () => {
    const r = avaliar(MEU_INSS, COMPLETO);
    expect(codigos(r)).not.toContain("INS3");
    expect(r.diligencias.map((d) => d.chave)).toContain("oficio-inss-dataprev");
  });

  it("averbação anterior à autorização aponta INS4", () => {
    expect(codigos(avaliar(MEU_INSS, `Averbação em 09/06/2026 10:00. ${COMPLETO}`))).toContain("INS4");
  });

  it("crédito anterior à autorização aponta INS4", () => {
    const r = avaliar(MEU_INSS, COMPLETO, { liberacao: { comprovante: { data: "09/06/2026" } } });
    expect(r.achados.find((a) => a.codigo === "INS4").texto).toMatch(/crédito comprovado \(09\/06\/2026\)/);
  });

  it("crédito no mesmo dia, sem hora, não permite afirmar anterioridade", () => {
    expect(codigos(avaliar(MEU_INSS, COMPLETO, { liberacao: { comprovante: { data: "10/06/2026" } } }))).not.toContain("INS4");
  });
});
