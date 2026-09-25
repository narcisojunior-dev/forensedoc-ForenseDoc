import { describe, it, expect } from "vitest";
import { fundamentacaoPara } from "../src/reports/laudoTexts.js";
import { classificarRegimeInss, fundamentacaoDoRegime } from "../src/engine/regimeInss.js";

const comRegime = (data) => {
  const r = classificarRegimeInss({ produtoCodigo: "CONSIGNADO_INSS", dataContrato: data });
  return { ...r, fundamentacao: fundamentacaoDoRegime(r) };
};
const grupo = (produto, regime, nome) => JSON.stringify(fundamentacaoPara(produto, regime).find((g) => g.grupo === nome));
const INSS = "Crédito consignado e benefício do INSS";

describe("fundamentação pelo regime INSS", () => {
  it("sem regime mantém o item genérico", () => {
    expect(grupo("CONSIGNADO_INSS", null, INSS)).toMatch(/Normas do INSS/);
  });

  it("contrato de 2021 cita a IN 28/2008 no lugar do item genérico", () => {
    const g = grupo("CONSIGNADO_INSS", comRegime("10/05/2021"), INSS);
    expect(g).toMatch(/IN INSS\/PRES nº 28\/2008/);
    expect(g).not.toMatch(/Normas do INSS/);
  });

  it("contrato de 2025 cita os dispositivos da IN 138 mapeados no acervo", () => {
    expect(grupo("CONSIGNADO_INSS", comRegime("15/03/2025"), INSS)).toMatch(/art\. 4º, VIII, e art\. 5º, II, III e § 5º/);
  });

  it("contrato de setembro de 2026 cita a IN 213 com ressalva e a norma de maio sem número", () => {
    const g = grupo("CONSIGNADO_INSS", comRegime("10/09/2026"), INSS);
    expect(g).toMatch(/IN PRES\/INSS nº 213\/2026 \(texto e vigência a conferir no DOU\)/);
    expect(g).toMatch(/Norma do INSS de maio de 2026/);
  });

  it("CLT continua sem normas do INSS", () => {
    expect(grupo("CONSIGNADO_CLT", comRegime("10/09/2026"), "Crédito consignado do trabalhador (CLT)")).not.toMatch(/INSS/);
  });
});
