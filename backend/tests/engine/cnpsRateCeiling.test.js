import { test } from "vitest";
import assert from "node:assert/strict";
import { cnpsCeilingAt } from "../../src/engine/cnpsRateCeiling.js";

test("17/10/2023 (data do contrato Facta): teto de 2,83% ao mês", () => {
  const result = cnpsCeilingAt("17/10/2023");
  assert.equal(result.tetoMensal, 2.83);
});

test("18/10/2023 em diante: teto de 2,73% ao mês (Resolução CNPS 1.359)", () => {
  const result = cnpsCeilingAt("18/10/2023");
  assert.equal(result.tetoMensal, 2.73);
  assert.match(result.resolucao, /1\.359/);
});

test("data muito distante e não coberta pela tabela: não inventa um teto", () => {
  assert.equal(cnpsCeilingAt("01/01/2010"), null);
  assert.equal(cnpsCeilingAt(null), null);
});
