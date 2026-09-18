import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fichaBeneficioSeAplica } from "../../src/engine/produto.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

/**
 * D7 · ficha de INSS impressa em contrato celetista.
 *
 * O § 3 do laudo FD-20260917 imprimiu "Matrícula INSS", "Número do benefício" e
 * "Espécie do benefício", os três como não identificados, num contrato que o
 * próprio § 2 classificou como consignado CLT e cujas condições gerais trazem o
 * rodapé CG.CLTv1.20250420.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));

describe("D7 · ficha de qualificação por modalidade", () => {
  it("consignado CLT não comporta campos de benefício previdenciário", () => {
    expect(fichaBeneficioSeAplica("CONSIGNADO_CLT")).toBe(false);
  });

  it("consignado de servidor também não comporta", () => {
    expect(fichaBeneficioSeAplica("CONSIGNADO_SERVIDOR")).toBe(false);
  });

  it("consignado do INSS comporta", () => {
    expect(fichaBeneficioSeAplica("CONSIGNADO_INSS")).toBe(true);
  });

  /** Na dúvida o laudo mostra o que leu: supressão só com modalidade afirmada. */
  it.each([[null], [undefined], [""], ["INDETERMINADO"], ["MODALIDADE_NOVA"]])(
    "modalidade indeterminada (%s) mantém os campos",
    (codigo) => {
      expect(fichaBeneficioSeAplica(codigo)).toBe(true);
    },
  );

  it("o dossiê C6 é classificado como CLT e, portanto, sem ficha de benefício", () => {
    const extraido = heuristicExtractionFromText(texto);
    expect(extraido.contrato.produto_codigo).toBe("CONSIGNADO_CLT");
    expect(fichaBeneficioSeAplica(extraido.contrato.produto_codigo)).toBe(false);
  });
});
