import { describe, it, expect } from "vitest";
import { analisarDispositivo, lancamentoChrome, chromeEsperadoEm } from "../../src/engine/dispositivo.js";

const TRILHA_C6 =
  "Coleta da Biometria Facial (assinatura eletrônica da CCB) Hora GMT, Data: 12/12/2024 11:06:39 IP e Porta Lógica: 2804:3128:1506:105e:997c:e781:bb6e:774:48962 Latitude e Longitude: -5.0484115 / -42.7545639 Navegador e versão do celular: Mozilla/5.0 (Linux; Android 11; moto e32) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.85 Mobile Safari/537.36 Identificador do aparelho: jcHJ8qqZkProloI78hLl REPRESENTANTE LEGAL: Não";

describe("tabela de versões do Chrome", () => {
  it("ancora a 94 em setembro de 2021 e projeta depois da 140", () => {
    expect(new Date(lancamentoChrome(94)).toISOString().slice(0, 7)).toBe("2021-09");
    expect(new Date(lancamentoChrome(120)).toISOString().slice(0, 7)).toBe("2023-12");
    expect(lancamentoChrome(150)).toBeGreaterThan(lancamentoChrome(140));
    expect(chromeEsperadoEm(Date.UTC(2024, 11, 12))).toBeGreaterThanOrEqual(130);
    expect(chromeEsperadoEm(Date.UTC(2024, 11, 12))).toBeLessThanOrEqual(133);
  });
});

describe("analisarDispositivo (dossiê C6)", () => {
  const d = analisarDispositivo({ flat: TRILHA_C6, ips: [], dataAto: "12/12/2024 11:06:39", fusoAto: "GMT" });
  it("lê modelo, sistema, navegador e identificador", () => {
    expect(d.modelo).toBe("moto e32");
    expect(d.sistema).toBe("Android");
    expect(d.versao_sistema).toBe("11");
    expect(d.navegador).toBe("Google Chrome");
    expect(d.versao_navegador).toBe("94.0.4606.85");
    expect(d.identificador).toBe("jcHJ8qqZkProloI78hLl");
    expect(d.resumo).toMatch(/moto e32 · Android 11 · Google Chrome 94/);
  });
  it("aponta DEV2 para navegador com mais de um ano na data do ato", () => {
    const dev2 = d.achados.find((a) => a.codigo === "DEV2");
    expect(dev2).toBeTruthy();
    expect(dev2.gravidade).toBe("INFO");
    expect(dev2.grau).toBe("INDÍCIO");
    expect(d.defasagem_navegador.meses).toBeGreaterThanOrEqual(36);
    expect(dev2.texto).toMatch(/WebView/);
  });
  it("não aponta DEV3 quando há modelo", () => {
    expect(d.achados.some((a) => a.codigo === "DEV3")).toBe(false);
  });
});

describe("analisarDispositivo (casos de borda)", () => {
  it("navegador atual não gera DEV2", () => {
    const d = analisarDispositivo({
      flat: "Navegador: Mozilla/5.0 (Linux; Android 14; SM-A155M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36",
      dataAto: "12/12/2024 11:06:39",
    });
    expect(d.modelo).toBe("SM-A155M");
    expect(d.achados.some((a) => a.codigo === "DEV2")).toBe(false);
  });
  it("user agent reduzido (Android 10; K) não vira modelo K", () => {
    const d = analisarDispositivo({
      flat: "Navegador e versão do celular: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36 Identificador do aparelho: Cw8VBYf2zdyHZHfr0Wx7",
      dataAto: "25/06/2025 10:45:03",
      fusoAto: "GMT",
    });
    expect(d.modelo).toBeNull();
    expect(d.modelo_nota).toMatch(/user agent reduzido/);
    expect(d.navegador).toBe("Samsung Internet");
    expect(d.achados.map((a) => a.codigo)).toEqual(["DEV3"]);
    expect(d.achados[0].texto).toMatch(/letra K/);
  });
  it("identificador sem user agent gera DEV3 e não quebra", () => {
    const d = analisarDispositivo({ flat: "Identificador do aparelho: abc123def456", dataAto: null });
    expect(d.identificador).toBe("abc123def456");
    expect(d.achados.map((a) => a.codigo)).toEqual(["DEV3"]);
  });
  it("sem nada retorna null", () => {
    expect(analisarDispositivo({ flat: "contrato sem trilha" })).toBeNull();
  });
});
