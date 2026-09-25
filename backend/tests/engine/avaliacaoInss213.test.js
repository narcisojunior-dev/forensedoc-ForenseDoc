import { describe, it, expect } from "vitest";
import { avaliarAutorizacaoInss } from "../../src/engine/avaliacaoInss.js";
import { extrairEvidenciasAutorizacao } from "../../src/engine/evidenciasAutorizacao.js";

const codigos = (r) => r.achados.map((a) => a.codigo);
const IN213 = (via, data = "25/08/2026") => ({ codigo: "IN_213_VIA_DUPLA", rotulo: "Autorização no Meu INSS por biometria facial ou pela conta gov.br", data_contrato: data, via });
const avaliar = (regime, texto) => avaliarAutorizacaoInss({ regime, evidencias: extrairEvidenciasAutorizacao(texto) });

const GOVBR_COMPLETO = [
  "Autorização no Meu INSS em 25/08/2026 às 10:00 por acesso gov.br, nível prata.",
  "IP 177.10.20.30 Dispositivo: Android 14 SM-A155M",
  "Beneficiário sem biometria cadastrada nas bases oficiais.",
  "Conta bancária validada: Banco 104 Agência 1234 Conta 99999-0",
  "Conta de recebimento do benefício: Banco 104 Agência 1234 Conta 99999-0",
  "DIB: 01/01/2026. Demonstrativo prévio anexo.",
].join("\n");

describe("autorização INSS: IN 213 e DIB", () => {
  it("via não identificada aponta INS5", () => {
    expect(codigos(avaliar(IN213(null), "DIB: 01/01/2026"))).toContain("INS5");
  });

  it("via ambígua explica que as duas foram mencionadas", () => {
    const r = avaliar(IN213("AMBIGUA"), "DIB: 01/01/2026");
    expect(r.achados.find((a) => a.codigo === "INS5").texto).toMatch(/tanto a biometria facial quanto/);
  });

  it("via gov.br completa e cabível não gera achado de via", () => {
    const r = avaliar(IN213("GOVBR"), GOVBR_COMPLETO);
    expect(codigos(r)).toEqual([]);
  });

  it("via gov.br com biometria cadastrada aponta INS6", () => {
    const texto = GOVBR_COMPLETO.replace("sem biometria cadastrada nas bases oficiais", "com biometria cadastrada na base da CNH");
    expect(codigos(avaliar(IN213("GOVBR"), texto))).toContain("INS6");
  });

  it("via gov.br sem prova de que faltava biometria aponta INS7", () => {
    const texto = GOVBR_COMPLETO.replace("Beneficiário sem biometria cadastrada nas bases oficiais.", "");
    expect(codigos(avaliar(IN213("GOVBR"), texto))).toContain("INS7");
  });

  it("via gov.br sem log aponta INS8 com a lista do que falta", () => {
    const r = avaliar(IN213("GOVBR"), "Autorização no Meu INSS em 25/08/2026 por acesso gov.br. DIB: 01/01/2026.");
    const ins8 = r.achados.find((a) => a.codigo === "INS8");
    expect(ins8.texto).toMatch(/nível da conta gov\.br, o IP de acesso, o dispositivo de acesso e a conta bancária validada/);
  });

  it("via gov.br não cobra selfie nem prova de vida (sem INS3)", () => {
    expect(codigos(avaliar(IN213("GOVBR"), "Acesso gov.br. DIB: 01/01/2026."))).not.toContain("INS3");
  });

  it("conta validada diferente da conta do benefício aponta INS9", () => {
    const texto = GOVBR_COMPLETO.replace("Conta bancária validada: Banco 104 Agência 1234 Conta 99999-0", "Conta bancária validada: Banco 104 Agência 1234 Conta 55555-1");
    expect(codigos(avaliar(IN213("GOVBR"), texto))).toContain("INS9");
  });

  it("via facial na IN 213 segue a régua do Meu INSS (INS3)", () => {
    expect(codigos(avaliar(IN213("FACIAL"), "DIB: 01/01/2026"))).toContain("INS3");
  });

  it("contrato 46 dias depois da DIB aponta INS10", () => {
    const r = avaliar(IN213("GOVBR"), GOVBR_COMPLETO.replace("DIB: 01/01/2026", "DIB: 10/07/2026"));
    expect(r.achados.find((a) => a.codigo === "INS10").texto).toMatch(/46 dias depois da data de início do benefício/);
  });

  it("sem DIB aponta INS11 e pede a carta de concessão", () => {
    const r = avaliar(IN213("GOVBR"), GOVBR_COMPLETO.replace("DIB: 01/01/2026. ", ""));
    expect(codigos(r)).toContain("INS11");
    expect(r.diligencias.map((d) => d.chave)).toContain("dib-beneficio");
  });

  it("a vedação dos 90 dias não alcança contrato anterior à IN 213", () => {
    const regime = { codigo: "MEU_INSS_BIOMETRIA", rotulo: "Meu INSS", data_contrato: "10/06/2026", via: "FACIAL" };
    expect(codigos(avaliar(regime, ""))).not.toContain("INS11");
  });
});
