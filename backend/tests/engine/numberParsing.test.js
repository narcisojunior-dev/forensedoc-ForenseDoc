import { test } from "vitest";
import assert from "node:assert/strict";
import { moneyToCents, percentToNumber } from "../../src/engine/numberParsing.js";

test("valor monetário ausente não vira zero", () => {
  assert.equal(moneyToCents(undefined), null);
  assert.equal(moneyToCents(null), null);
  assert.equal(moneyToCents(""), null);
  assert.equal(moneyToCents("R$"), null);
});

test("valor zero explícito continua válido", () => {
  assert.equal(moneyToCents("R$ 0,00"), 0);
});

test("converte números localizados sem perder centavos", () => {
  assert.equal(moneyToCents("R$ 1.234,56"), 123456);
  assert.equal(percentToNumber("3,373%"), 3.373);
  assert.equal(percentToNumber(undefined), null);
});
