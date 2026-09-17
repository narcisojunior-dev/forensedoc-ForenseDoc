import { test } from "vitest";
import assert from "node:assert/strict";
import { stripPjeFooter } from "../../src/engine/pjeText.js";

test("remove as cinco linhas integrais do rodapé do PJe e preserva o corpo", () => {
  const input = [
    "CONTRATO BANCÁRIO",
    "Assinado eletronicamente por: MARIA CLIENTE",
    "Assinado eletronicamente por: ADVOGADO DO BANCO - 12/02/2026 09:18:37",
    "https://pje.tjpi.jus.br:443/1g/Processo/ConsultaDocumento/listView.seam?x=123",
    "Número do documento: 26021209183700000000012345",
    "Este documento foi gerado pelo usuário 014.***.***-61 em 07/06/2026 22:24:38",
    "Num. 90576750 - Pág. 8",
  ].join("\n");
  const result = stripPjeFooter(input);
  assert.equal(result.removed.length, 5);
  assert.match(result.text, /CONTRATO BANCÁRIO/);
  assert.match(result.text, /Assinado eletronicamente por: MARIA CLIENTE/);
  assert.doesNotMatch(result.text, /ADVOGADO DO BANCO/);
});

test("não remove menção legítima no corpo nem assinatura sem carimbo PJe", () => {
  const input = "O contrato menciona assinatura eletrônica como requisito.\nAssinado eletronicamente por: MARIA CLIENTE";
  assert.deepEqual(stripPjeFooter(input), { text: input, removed: [] });
});

test("texto sem rodapé atravessa sem alteração", () => {
  const input = "Linha um\r\nLinha dois\r\n";
  assert.equal(stripPjeFooter(input).text, input);
});
