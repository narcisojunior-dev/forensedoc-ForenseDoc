import { describe, it, expect } from "vitest";
import { generateJudicialQuesitos } from "../src/reports/quesitosTemplate.js";
import { generateJudicialQuesitos as naTela } from "../../frontend/src/laudo/quesitos.js";

const GOVBR = {
  regime_inss: {
    codigo: "IN_213_VIA_DUPLA", via: "GOVBR", data_contrato: "25/08/2026", regra_dib_dias: 90,
    evidencias: {
      dib: "10/07/2026",
      meu_inss: { autorizacao: { data: "26/08/2026", hora: "09:15:00" } },
      conta_validada: { agencia: "1234", conta: "55555-1" },
      conta_beneficio: { agencia: "1234", conta: "99999-0" },
    },
  },
};
const ACHADOS_GOVBR = [
  { codigo: "INS4", gravidade: "ALTA" },
  { codigo: "INS7", gravidade: "ALTA" },
  { codigo: "INS8", gravidade: "ALTA" },
  { codigo: "INS9", gravidade: "ALTA" },
  { codigo: "INS10", gravidade: "ALTA" },
];

describe("quesitos da autorização INSS", () => {
  it("via gov.br tira o quesito geral de prova de vida e traz os quesitos da via", () => {
    const titulos = generateJudicialQuesitos({ achados: ACHADOS_GOVBR, extracted: GOVBR }).map((q) => q.titulo);
    expect(titulos.some((t) => /Liveness/.test(t))).toBe(false);
    expect(titulos).toEqual(expect.arrayContaining([
      "Cronologia entre Autorização, Averbação e Crédito",
      "Cabimento da Autorização pela Conta gov.br",
      "Registro de Acesso pela Conta gov.br",
      "Conta Validada e Conta de Recebimento do Benefício",
      "Contratação nos Primeiros 90 Dias do Benefício",
    ]));
  });

  it("regime Meu INSS leva quesito ao INSS e à Dataprev e mantém o de prova de vida", () => {
    const extracted = { regime_inss: { codigo: "MEU_INSS_BIOMETRIA", via: "FACIAL", data_contrato: "10/06/2026", evidencias: {} } };
    const qs = generateJudicialQuesitos({ achados: [{ codigo: "INS3", gravidade: "ALTA" }], extracted });
    const ins3 = qs.find((q) => q.titulo === "Registro da Autorização no Meu INSS (Ofício ao INSS e à Dataprev)");
    expect(ins3.quesito).toMatch(/Dataprev/);
    expect(qs.some((q) => /Liveness/.test(q.titulo))).toBe(true);
  });

  it("tela e servidor geram os mesmos quesitos", () => {
    expect(naTela({ achados: ACHADOS_GOVBR, extracted: GOVBR })).toEqual(generateJudicialQuesitos({ achados: ACHADOS_GOVBR, extracted: GOVBR }));
  });
});
