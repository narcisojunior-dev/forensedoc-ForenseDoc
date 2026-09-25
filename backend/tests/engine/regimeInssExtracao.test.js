import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";
import { TEXTO_GOVBR } from "../helpers/textoInss.js";

describe("regime INSS na extração", () => {
  it("classifica o regime e leva os achados da via gov.br", () => {
    const e = heuristicExtractionFromText(TEXTO_GOVBR);
    expect(e.contrato.produto_codigo).toBe("CONSIGNADO_INSS");
    expect(e.regime_inss.codigo).toBe("IN_213_VIA_DUPLA");
    expect(e.regime_inss.via).toBe("GOVBR");
    expect(e.regime_inss.via_rotulo).toBe("Conta gov.br com validação dos dados bancários");
    expect(e.regime_inss.nota_oficio).toMatch(/requisitado por ofício/);
    const codigos = e.achados_irregularidade.map((a) => a.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["INS4", "INS7", "INS9", "INS10"]));
    // Demonstrativo prévio: diligência enquanto o dispositivo não for conferido.
    expect(codigos).not.toContain("INS2");
    expect(e.regime_inss.diligencias.map((d) => d.chave)).toContain("demonstrativo-previo");
    expect(codigos).not.toContain("INS3");
    expect(e.regime_inss.fundamentacao.length).toBe(3);
    expect(e.regime_inss.diligencias.map((d) => d.chave)).toContain("oficio-inss-dataprev");
  });

  it("extrai a UF do correspondente", () => {
    expect(heuristicExtractionFromText(TEXTO_GOVBR).correspondente.uf).toBe("SP");
  });

  it("o dossiê C6 (CLT) fica sem regime e sem achados INS", async () => {
    const caso = JSON.parse(await readFile(new URL("../corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
    const e = heuristicExtractionFromText(caso.texto);
    expect(e.regime_inss).toBeNull();
    expect(e.achados_irregularidade.some((a) => /^INS\d/.test(a.codigo))).toBe(false);
  });
});
