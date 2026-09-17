import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { distanciaKm, formatarDistancia, distanciaSuspeita, montarConfrontoGeografico } from "../src/utils/distancia.js";

/**
 * CRIT-01 da rodada 2: `Number(null)` é 0, e uma distância não calculada virou
 * "0,00 km" em selo favorável. Este teste procura a coerção no código-fonte do
 * backend e do laudo da tela, para que ela não volte por outro caminho.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PASTAS = ["backend/src", "frontend/src/laudo", "frontend/src/components/report", "frontend/src/pages"];
const COERCAO = /Number\(\s*[\w?.[\]]*\b(?:distance|distanceToSignature|gpsDistance|distancia\w*|km)\b\s*\)/;

async function arquivos(dir) {
  const saida = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, item.name);
    if (item.isDirectory()) saida.push(...(await arquivos(caminho)));
    else if (/\.(m?js|jsx)$/.test(item.name) && !/distancia\.js$/.test(item.name)) saida.push(caminho);
  }
  return saida;
}

describe("distância nunca é convertida de nulo para zero", () => {
  it("nenhum Number() sobre campo de distância no código", async () => {
    const achados = [];
    for (const pasta of PASTAS) {
      for (const arquivo of await arquivos(path.join(RAIZ, pasta))) {
        (await readFile(arquivo, "utf8")).split("\n").forEach((linha, i) => {
          if (COERCAO.test(linha)) achados.push(`${path.relative(RAIZ, arquivo)}:${i + 1}: ${linha.trim()}`);
        });
      }
    }
    expect(achados).toEqual([]);
  });

  it("utilitário trata ausência como null, e zero como suspeito", () => {
    expect([null, undefined, "", "abc", -1].map(distanciaKm)).toEqual([null, null, null, null, null]);
    expect(distanciaKm(0)).toBe(0);
    expect(distanciaKm("12,5")).toBe(12.5);
    expect(formatarDistancia(null)).toBeNull();
    expect(formatarDistancia(0.5)).toBe("0,50 km");
    expect(distanciaSuspeita(0)).toBe(true);
    expect(distanciaSuspeita(null)).toBe(false);
  });

  it("confronto sem referência não traz distância, mas preserva GPS contra IP", () => {
    const c = montarConfrontoGeografico({
      home: { estado_confronto: "RECUSADO_CONFLITO", geo: null },
      contractGeo: { distance: null },
      ipAnalysis: [{ endereco: "2804::1", distance: null, distanceToSignature: 23.4 }],
    });
    expect(c).toMatchObject({ status: "RECUSADO_CONFLITO", gps_ip: 23.4, distancias: { gps_residencia: null } });
    expect(c.distancias.ips_residencia[0].km).toBeNull();
  });
});
