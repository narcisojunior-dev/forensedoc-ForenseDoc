import { describe, it, expect } from "vitest";
import { mapPointsIpVsHome, mapPointsHomeVsDeclared } from "../src/services/staticMapService.js";

/**
 * O § 5 do laudo passou a ter DOIS confrontos independentes, cada um com seu
 * mapa. Antes era um quadro único com três pontos, o que misturava duas
 * perguntas periciais de naturezas diferentes — e a escala do confronto de IP
 * (centenas de km) achatava o outro até os pontos virarem um só pixel.
 */
const RESULT = {
  home: { geo: { lat: -3.434452, lon: -60.4725532, precision: "manual" } },
  contractGeo: { lat: -3.4340189, lon: -60.4593232, precision: "gps" },
  ipAnalysis: [{ endereco: "2804:18::1", geo: { lat: -3.12845, lon: -58.15856 } }],
};

describe("mapPointsIpVsHome — Mapa 1", () => {
  it("devolve o par residência → origem do IP", () => {
    const p = mapPointsIpVsHome(RESULT);
    expect(p).toHaveLength(2);
    expect(p[0].label).toBe("R");
    expect(p[1].label).toBe("I");
    expect(p[1].lat).toBe(-3.12845);
  });

  it("a referência vem primeiro — é dela que a linha parte", () => {
    expect(mapPointsIpVsHome(RESULT)[0].lat).toBe(RESULT.home.geo.lat);
  });

  it("ignora IP sem coordenada", () => {
    const semGeo = { ...RESULT, ipAnalysis: [{ endereco: "x", geo: null }] };
    expect(mapPointsIpVsHome(semGeo)).toEqual([]);
  });

  it("usa o PRIMEIRO IP geolocalizado, não o primeiro da lista", () => {
    // Dossiês de trilha repetem endereços; alguns podem não geolocalizar.
    const misto = {
      ...RESULT,
      ipAnalysis: [
        { endereco: "sem-geo", geo: null },
        { endereco: "com-geo", geo: { lat: -1.1, lon: -48.5 } },
      ],
    };
    expect(mapPointsIpVsHome(misto)[1].lat).toBe(-1.1);
  });

  it("não produz mapa sem a referência", () => {
    expect(mapPointsIpVsHome({ ...RESULT, home: null })).toEqual([]);
  });
});

describe("mapPointsHomeVsDeclared — Mapa 2", () => {
  it("devolve o par residência → geolocalização declarada", () => {
    const p = mapPointsHomeVsDeclared(RESULT);
    expect(p).toHaveLength(2);
    expect(p[0].label).toBe("R");
    expect(p[1].label).toBe("A");
    expect(p[1].lat).toBe(-3.4340189);
  });

  it("NÃO inclui o ponto do IP", () => {
    // A separação é o ponto de todo o refactor: misturar as escalas foi o que
    // tornou o mapa anterior ilegível.
    const labels = mapPointsHomeVsDeclared(RESULT).map((p) => p.label);
    expect(labels).not.toContain("I");
  });

  it("é vazio quando o documento não declara geolocalização", () => {
    expect(mapPointsHomeVsDeclared({ ...RESULT, contractGeo: null })).toEqual([]);
  });
});

describe("independência dos dois mapas", () => {
  it("cada um tem exatamente dois pontos e compartilha só a referência", () => {
    const m1 = mapPointsIpVsHome(RESULT);
    const m2 = mapPointsHomeVsDeclared(RESULT);
    expect(m1).toHaveLength(2);
    expect(m2).toHaveLength(2);
    expect(m1[0]).toEqual(m2[0]); // mesma residência nos dois
    expect(m1[1].label).not.toBe(m2[1].label); // pontos confrontados distintos
  });

  it("cores distintas para o ponto confrontado, para a legenda casar com o traço", () => {
    expect(mapPointsIpVsHome(RESULT)[1].color).toBe("#dc2626");
    expect(mapPointsHomeVsDeclared(RESULT)[1].color).toBe("#f59e0b");
  });

  it("tolera result vazio sem estourar", () => {
    for (const entrada of [{}, null, undefined]) {
      expect(mapPointsIpVsHome(entrada)).toEqual([]);
      expect(mapPointsHomeVsDeclared(entrada)).toEqual([]);
    }
  });
});
