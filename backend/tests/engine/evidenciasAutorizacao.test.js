import { describe, it, expect } from "vitest";
import { extrairEvidenciasAutorizacao } from "../../src/engine/evidenciasAutorizacao.js";

const MEU_INSS_FACIAL = [
  "Autorização no Meu INSS registrada em 10/06/2026 às 14:32:10.",
  "Método: biometria facial com prova de vivacidade, confronto com a base da CNH.",
  "Averbação em 11/06/2026. DIB: 02/01/2026.",
  "Demonstrativo prévio da operação apresentado em 09/06/2026.",
].join("\n");

const GOVBR = [
  "Autorização no Meu INSS em 20/08/2026 10:00 por acesso gov.br, nível prata.",
  "IP 177.10.20.30 Dispositivo: Android 14 SM-A155M",
  "Beneficiário sem biometria cadastrada nas bases oficiais.",
  "Conta bancária validada: Banco 104 Agência 1234 Conta 55555-1",
  "Conta de recebimento do benefício: Banco 104 Agência 1234 Conta 99999-0",
].join("\n");

describe("evidências de autorização do consignado INSS", () => {
  it("lê a autorização facial no Meu INSS", () => {
    const e = extrairEvidenciasAutorizacao(MEU_INSS_FACIAL);
    expect(e.meu_inss.autorizacao).toEqual({ data: "10/06/2026", hora: "14:32:10" });
    expect(e.meu_inss.via_facial).toBe(true);
    expect(e.meu_inss.vivacidade).toBe(true);
    expect(e.meu_inss.bases_oficiais).toEqual(["CNH"]);
    expect(e.via).toBe("FACIAL");
    expect(e.averbacao).toEqual({ data: "11/06/2026", hora: null });
    expect(e.dib).toBe("02/01/2026");
    expect(e.demonstrativo_previo).toBe(true);
    expect(e.biometria_cadastrada).toBeNull();
  });

  it("lê a via gov.br com nível, IP, dispositivo e contas", () => {
    const e = extrairEvidenciasAutorizacao(GOVBR);
    expect(e.via).toBe("GOVBR");
    expect(e.govbr).toEqual({ mencionado: true, nivel: "prata", ip: "177.10.20.30", dispositivo: "Android 14 SM-A155M" });
    expect(e.biometria_cadastrada).toBe(false);
    expect(e.conta_validada).toEqual({ banco: "104", agencia: "1234", conta: "55555-1" });
    expect(e.conta_beneficio).toEqual({ banco: "104", agencia: "1234", conta: "99999-0" });
  });

  it("biometria declarada como cadastrada", () => {
    expect(extrairEvidenciasAutorizacao("Beneficiário com biometria cadastrada na base da CNH.").biometria_cadastrada).toBe(true);
  });

  it("duas vias mencionadas ficam ambíguas", () => {
    expect(extrairEvidenciasAutorizacao(`${MEU_INSS_FACIAL}\n${GOVBR}`).via).toBe("AMBIGUA");
  });

  it("horário isolado não é lido como IPv6", () => {
    expect(extrairEvidenciasAutorizacao("Acesso gov.br às 10:25:33, nível ouro.").govbr.ip).toBeNull();
  });

  it("texto sem nada disso devolve tudo vazio", () => {
    const e = extrairEvidenciasAutorizacao("Cédula de crédito bancário. Selfie capturada.");
    expect(e.meu_inss.mencionado).toBe(false);
    expect(e.meu_inss.autorizacao).toBeNull();
    expect(e.via).toBeNull();
    expect(e.dib).toBeNull();
    expect(e.demonstrativo_previo).toBe(false);
  });
});
