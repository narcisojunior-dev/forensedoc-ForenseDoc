import { describe, it, expect } from "vitest";
import { recomputeDerived } from "../src/services/analysisRecompute.js";

/**
 * Tudo que DERIVA dos dados precisa ser refeito quando eles mudam.
 *
 * A correção de coordenada atualizava os quilômetros e deixava as classificações
 * intactas: o laudo exibia a distância nova ao lado do rótulo antigo, com 12 km
 * marcados como "DIVERGÊNCIA GRAVE" porque a classificação era de quando a
 * distância era 800. Número e veredito se contradiziam na mesma linha.
 */
const extraido = {
  cliente: { nome: "Fulano" },
  assinatura: { presente: true, hash_documento_assinado: null },
  ips: [{ endereco: "189.40.112.87" }],
};

const base = () => ({
  text: JSON.stringify(extraido),
  home: { source: "manual", geo: { lat: -7.115, lon: -34.863, precision: "manual" } },
  contractGeo: {
    lat: -7.12,
    lon: -34.87,
    precision: "gps",
    // Valores DESATUALIZADOS de propósito: é o estado que o bug produzia.
    distance: 800,
    divergencia: { km: 800, nivel: "grave", rotulo: "DIVERGÊNCIA GRAVE", tom: "danger" },
  },
  ipAnalysis: [
    {
      endereco: "189.40.112.87",
      geo: { lat: -23.73, lon: -46.44 },
      distance: 800,
      divergenciaResidencia: { km: 800, nivel: "grave", rotulo: "DIVERGÊNCIA GRAVE" },
    },
  ],
  geoDeclaredPresent: true,
});

describe("recomputeDerived", () => {
  it("a classificação acompanha a distância recalculada", () => {
    const r = recomputeDerived(base(), extraido);
    expect(r.contractGeo.distance).toBeLessThan(2);
    expect(r.contractGeo.divergencia.km).toBe(r.contractGeo.distance);
    expect(r.contractGeo.divergencia.nivel).toBe("compativel");
  });

  it("a classificação do IP é recalculada a partir da distância real", () => {
    const r = recomputeDerived(base(), extraido);
    const ip = r.ipAnalysis[0];
    // O valor gravado era 800 km. A distância real entre a referência (PB) e o
    // IP (SP) é maior que isso, e a classificação tem que refletir a real.
    expect(ip.distance).toBeGreaterThan(1000);
    expect(ip.divergenciaResidencia.km).toBe(ip.distance);
  });

  it("nenhum número fica órfão do seu rótulo", () => {
    // A propriedade que o bug violava, escrita de forma direta.
    const r = recomputeDerived(base(), extraido);
    expect(r.contractGeo.divergencia.km).toBe(r.contractGeo.distance);
    for (const ip of r.ipAnalysis) {
      if (ip.divergenciaResidencia) expect(ip.divergenciaResidencia.km).toBe(ip.distance);
      if (ip.divergenciaAssinatura) expect(ip.divergenciaAssinatura.km).toBe(ip.distanceToSignature);
    }
  });

  it("a cadeia de custódia sobe quando um elemento passa a existir", () => {
    // É o efeito de o operador preencher um campo que faltava, e é o motivo de
    // a cadeia precisar ser refeita aqui.
    const semHash = recomputeDerived(base(), extraido);
    const comHash = recomputeDerived(base(), {
      ...extraido,
      assinatura: { ...extraido.assinatura, hash_documento_assinado: "A".repeat(64) },
    });
    expect(comHash.cadeiaCustodia.presentes).toBeGreaterThan(semHash.cadeiaCustodia.presentes);
  });

  it("sem referência confirmada, não inventa distância", () => {
    const semHome = { ...base(), home: null };
    const r = recomputeDerived(semHome, extraido);
    expect(r.contractGeo.distance).toBeNull();
    expect(r.contractGeo.divergencia).toBeNull();
    expect(r.ipAnalysis[0].divergenciaResidencia).toBeNull();
  });

  it("não estoura sem contractGeo nem IPs", () => {
    const vazio = { text: JSON.stringify(extraido), home: null, ipAnalysis: [] };
    expect(() => recomputeDerived(vazio, extraido)).not.toThrow();
  });
});
