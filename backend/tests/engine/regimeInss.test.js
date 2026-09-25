import { describe, it, expect } from "vitest";
import {
  classificarRegimeInss, citarDispositivo, citarMarco, diasEntre, fundamentacaoDoRegime,
} from "../../src/engine/regimeInss.js";

const regime = (data, extra = {}) => classificarRegimeInss({ produtoCodigo: "CONSIGNADO_INSS", dataContrato: data, ...extra });

describe("regime de autorização do consignado INSS", () => {
  it("não se aplica fora do consignado INSS", () => {
    expect(classificarRegimeInss({ produtoCodigo: "CONSIGNADO_CLT", dataContrato: "10/06/2026" })).toBeNull();
  });

  it.each([
    ["30/11/2022", "IN_28_2008"],
    ["01/12/2022", "IN_138_SELFIE_BANCO"],
    ["30/04/2026", "IN_138_SELFIE_BANCO"],
    ["01/05/2026", "MEU_INSS_BIOMETRIA"],
    ["16/08/2026", "MEU_INSS_BIOMETRIA"],
    ["17/08/2026", "IN_213_VIA_DUPLA"],
  ])("contrato de %s cai no regime %s", (data, codigo) => {
    expect(regime(data).codigo).toBe(codigo);
  });

  it("sem data do contrato o regime é indeterminado", () => {
    expect(regime(null).codigo).toBe("INDETERMINADO");
  });

  it("contrato de março de 2025 sai sem ressalva, porque a IN 138 está conferida", () => {
    expect(regime("15/03/2025").ressalvas).toEqual([]);
  });

  it("regime com vigência não conferida leva ressalva", () => {
    expect(regime("15/06/2026").ressalvas.join(" ")).toMatch(/não foi conferido no Diário Oficial/);
  });

  it("contrato perto de marco não conferido avisa que o regime pode mudar", () => {
    expect(regime("30/04/2026").ressalvas.join(" ")).toMatch(/dista 1 dia do início presumido/);
  });

  it("contrato no próprio dia do marco também avisa", () => {
    expect(regime("01/05/2026").ressalvas.join(" ")).toMatch(/coincide com o início presumido/);
  });

  it("data lida sem rótulo leva ressalva", () => {
    expect(regime("15/03/2025", { confiancaData: "BAIXA" }).ressalvas.join(" ")).toMatch(/sem rótulo de contratação/);
  });

  it("a norma de maio de 2026 nunca é citada por número", () => {
    expect(citarMarco("MEU_INSS")).not.toMatch(/nº/);
  });

  it("a IN 213 é citada com ressalva de conferência", () => {
    expect(citarMarco("IN_213")).toBe("IN PRES/INSS nº 213/2026 (texto e vigência a conferir no DOU)");
  });

  it("artigo não conferido não é citado", () => {
    expect(citarDispositivo("LOCAL_DOMICILIO")).toBe("IN PRES/INSS nº 138/2022");
    expect(citarDispositivo("DEMONSTRATIVO_PREVIO")).toBe("IN PRES/INSS nº 138/2022");
  });

  it("diasEntre conta dias corridos", () => {
    expect(diasEntre("01/05/2026", "30/07/2026")).toBe(90);
  });

  it("fundamentação cresce com o regime", () => {
    expect(fundamentacaoDoRegime(regime("10/05/2021")).map(([d]) => d)).toEqual(["IN INSS/PRES nº 28/2008"]);
    expect(fundamentacaoDoRegime(regime("15/03/2025"))).toHaveLength(1);
    expect(fundamentacaoDoRegime(regime("15/06/2026"))).toHaveLength(2);
    expect(fundamentacaoDoRegime(regime("10/09/2026"))).toHaveLength(3);
    expect(fundamentacaoDoRegime(regime(null))).toEqual([]);
  });
});
