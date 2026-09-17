import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveBankByCnpj, cnpjRoot } from "../../src/engine/bankRegistry.js";

test("resolve o nome do banco pela raiz do CNPJ, ignorando pontuação", () => {
  const result = resolveBankByCnpj("60.746.948/0001-12");
  assert.equal(result.nome, "Banco Bradesco S.A.");
  assert.equal(result.compe, "237");
});

test("financeira (SCFI) sem código COMPE não inventa um número", () => {
  const result = resolveBankByCnpj("15.581.638/0001-30");
  assert.equal(result.nome, "Facta Financeira S.A. Crédito, Financiamento e Investimento");
  assert.equal(result.compe, null);
  assert.match(result.semCompeNota, /sem c[oó]digo COMPE/i);
});

test("CNPJ fora da tabela retorna null (não inventa banco)", () => {
  assert.equal(resolveBankByCnpj("11.222.333/0001-44"), null);
  assert.equal(resolveBankByCnpj(null), null);
  assert.equal(resolveBankByCnpj(""), null);
});

test("cnpjRoot extrai os 8 primeiros dígitos", () => {
  assert.equal(cnpjRoot("15.581.638/0001-30"), "15581638");
  assert.equal(cnpjRoot("123"), null);
});
