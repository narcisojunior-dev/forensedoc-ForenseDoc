import { describe, it, expect } from "vitest";
import { parseLatLon } from "../pages/Analyze.jsx";

/**
 * `parseLatLon` guarda a coordenada que o operador cola do Google Maps. Ela
 * alimenta o confronto geográfico do § 5 e a correção manual — o "padrão-ouro"
 * do laudo. Aceitar lixo aqui produz distância errada num documento pericial.
 */
describe("parseLatLon", () => {
  it("aceita o formato que o Google Maps copia", () => {
    expect(parseLatLon("-5.0951, -42.8100")).toEqual({ lat: -5.0951, lon: -42.81 });
  });

  it("tolera espaçamento e ponto e vírgula", () => {
    expect(parseLatLon("  -5.0951 ; -42.8100  ")).toEqual({ lat: -5.0951, lon: -42.81 });
    expect(parseLatLon("-5.0951 -42.8100")).toEqual({ lat: -5.0951, lon: -42.81 });
  });

  it("aceita coordenada sem casas decimais", () => {
    expect(parseLatLon("-5, -42")).toEqual({ lat: -5, lon: -42 });
  });

  it("recusa texto que não é coordenada", () => {
    for (const entrada of ["", "  ", "abc", "-5.0951", "lat -5 lon -42", "-5.0951,"]) {
      expect(parseLatLon(entrada)).toBeNull();
    }
  });

  it("recusa coordenada fora do Brasil", () => {
    // Nova York: fora da faixa, e o laudo é de consignado brasileiro.
    expect(parseLatLon("40.7128, -74.0060")).toBeNull();
    // Lisboa: longitude positiva.
    expect(parseLatLon("38.7223, -9.1393")).toBeNull();
  });

  it("recusa latitude e longitude invertidas", () => {
    // O erro mais comum ao colar à mão. "-42.81, -5.09" tem latitude fora da
    // faixa brasileira, então precisa cair.
    expect(parseLatLon("-42.8100, -5.0951")).toBeNull();
  });

  it("recusa valores não numéricos disfarçados", () => {
    expect(parseLatLon("NaN, -42.81")).toBeNull();
    expect(parseLatLon("-5.0951, Infinity")).toBeNull();
  });

  it("aceita os limites da faixa e recusa logo além", () => {
    expect(parseLatLon("5.9, -73.9")).not.toBeNull();
    expect(parseLatLon("6.1, -73.9")).toBeNull();
    expect(parseLatLon("-33.9, -74.1")).toBeNull();
  });
});
