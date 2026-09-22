import { describe, it, expect } from "vitest";
import { extractCep } from "../src/services/geocodingService.js";
import { buildGeocodeQueries } from "../src/utils/geoUtils.js";

/**
 * "CEP 69.435-000" é como o endereço costuma vir digitado na petição e no
 * cadastro. Sem aceitar o ponto de milhar, o CEP não era reconhecido, o
 * endereço não era geocodificado e o laudo saía sem a referência residencial,
 * que é justamente o ponto de origem de todas as distâncias do § 5.
 */
describe("CEP com separador de milhar", () => {
  it("é extraído com e sem o ponto", () => {
    expect(extractCep("Rua Solimões, S/N, Areal, CEP 69.435-000, Manaquiri - Amazonas")).toBe("69435000");
    expect(extractCep("Rua Solimões, S/N, Areal, CEP 69435-000, Manaquiri - AM")).toBe("69435000");
    expect(extractCep("Rua Solimões, S/N, Areal, 69435000, Manaquiri - AM")).toBe("69435000");
  });

  it("entra nas consultas de geocodificação", () => {
    const consultas = buildGeocodeQueries("Rua Solimões, S/N, Areal, CEP 69.435-000, Manaquiri - Amazonas");
    expect(JSON.stringify(consultas)).toMatch(/69\.?435-?000/);
  });

  it("não confunde valor monetário com CEP", () => {
    expect(extractCep("R$ 1.779,15")).toBeNull();
  });
});
