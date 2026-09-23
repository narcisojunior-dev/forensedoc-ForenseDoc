import { describe, it, expect } from "vitest";
import { montarConfrontoGeografico, STATUS_CONFRONTO, mesmoMunicipio, referenciaMunicipal } from "../../src/utils/distancia.js";
import * as frontend from "../../../frontend/src/laudo/distancia.js";
import { naoAferidoMesmoMunicipio } from "../../src/utils/geoDivergence.js";

// Laudo FD-20260922-ABC18B73E5: domicílio "Manaquiri, AM" resolvido pelo CEP
// genérico no centroide do município (55 km ao sul da sede); GPS do ato em
// Bacabal, na sede. O laudo chamou de "divergência grave, 69,6 km" a própria
// cidade da cliente.
const resultadoManaquiri = {
  home: {
    estado_confronto: "DISPONIVEL",
    geo: { lat: -3.9148823, lon: -60.8609358, precision: "city", matchedCity: "Manaquiri", matchedUf: "AM" },
    instrumento: { cidade: "Manaquiri", uf: "AM" },
  },
  contractGeo: { lat: -3.4340189, lon: -60.4593232, municipio: "Manaquiri", uf: "AM", distance: 69.61, distanceToInstrumento: 69.61 },
  ipAnalysis: [
    { endereco: "2804:18:6881:4f33::81fc", geo: { city: "Manacapuru", region: "Amazonas", lat: -3.29972, lon: -60.62056 }, distance: 73.42, distanceToSignature: 23.3 },
  ],
};

describe("referência residencial em nível de município", () => {
  it("reconhece a precisão municipal e compara nomes sem acento", () => {
    expect(referenciaMunicipal(resultadoManaquiri.home)).toBe(true);
    expect(referenciaMunicipal({ geo: { precision: "street" } })).toBe(false);
    expect(mesmoMunicipio("Manaquiri", "MANAQUIRI ")).toBe(true);
    expect(mesmoMunicipio("São Luís", "Sao Luis")).toBe(true);
    expect(mesmoMunicipio("Manaquiri", "Manacapuru")).toBe(false);
  });

  it("GPS no mesmo município não gera distância residencial; IP em outro município continua medido", () => {
    const c = montarConfrontoGeografico(resultadoManaquiri);
    expect(c.status).toBe(STATUS_CONFRONTO.CALCULADO);
    expect(c.referencia_municipal).toBe(true);
    expect(c.distancias.gps_residencia).toBeNull();
    expect(c.distancias.ips_residencia[0].km).toBe(73.42);
    expect(c.notas).toHaveLength(1);
    expect(c.notas[0]).toMatch(/mesmo município da referência \(Manaquiri\)/);
    // A distância GPS × IP não depende da residência e segue viva.
    expect(c.gps_ip).toBe(23.3);
  });

  it("com GPS e IP no mesmo município, o estado é REFERENCIA_MUNICIPAL e tem motivo", () => {
    const r = { ...resultadoManaquiri, ipAnalysis: [{ ...resultadoManaquiri.ipAnalysis[0], geo: { ...resultadoManaquiri.ipAnalysis[0].geo, city: "Manaquiri" }, distance: 55 }] };
    const c = montarConfrontoGeografico(r);
    expect(c.status).toBe(STATUS_CONFRONTO.REFERENCIA_MUNICIPAL);
    expect(c.distancias.ips_residencia[0]).toMatchObject({ km: null, mesmo_municipio: true });
    expect(c.motivo).toMatch(/nível de município/);
    expect(c.suspeitas).toBe(0);
  });

  it("referência de rua mantém a régua de quilômetros", () => {
    const r = { ...resultadoManaquiri, home: { ...resultadoManaquiri.home, geo: { ...resultadoManaquiri.home.geo, precision: "street" } } };
    const c = montarConfrontoGeografico(r);
    expect(c.distancias.gps_residencia).toBe(69.61);
    expect(c.notas).toEqual([]);
  });

  it("a cópia do frontend decide igual", () => {
    const a = montarConfrontoGeografico(resultadoManaquiri);
    const b = frontend.montarConfrontoGeografico(resultadoManaquiri);
    expect(b.status).toBe(a.status);
    expect(b.distancias).toEqual(a.distancias);
    expect(b.notas).toEqual(a.notas);
    expect(frontend.STATUS_CONFRONTO).toEqual(STATUS_CONFRONTO);
  });
});

describe("veredito não aferido por mesmo município", () => {
  it("não traz régua de km e explica o centroide", () => {
    const v = naoAferidoMesmoMunicipio({ km: 69.61, municipio: "Manaquiri", tipo: "gps" });
    expect(v).toMatchObject({ nivel: "nao_aferido", tom: "ok", km: 69.61, mesmo_municipio: true });
    expect(v.rotulo).not.toMatch(/GRAVE/);
    expect(v.sintese).toMatch(/mesmo município \(Manaquiri\)/);
    expect(naoAferidoMesmoMunicipio({ km: null, tipo: "ip" }).km).toBeNull();
  });
});
