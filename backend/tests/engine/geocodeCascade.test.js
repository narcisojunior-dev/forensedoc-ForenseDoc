import { test } from "vitest";
import assert from "node:assert/strict";
import { geocodeResultMatches, extractCityCandidates, isWholeMunicipalityCep, normalizedGeoText } from "../../src/engine/geocodeCascade.js";

// Caso real do relatório técnico de 09/09/2026 (item 6): o endereço abaixo
// foi geocodificado 369 km fora do lugar porque a validação antiga
// aprovava qualquer resultado quando não conseguia extrair um candidato de
// cidade do texto (`[].every(fn)` é `true` em JavaScript).
const RELATORIO_QUERY = "Rua R, zona rural, boa hora/Pi. cep 64108000 Brasil";

test("extrai o município mesmo com separador '/UF.' (sem rótulo 'cidade:')", () => {
  const candidates = extractCityCandidates(normalizedGeoText(RELATORIO_QUERY));
  assert.deepEqual(candidates, ["boa hora"]);
});

test("rejeita um resultado de outro município/estado (o bug dos 369 km)", () => {
  const matches = geocodeResultMatches(RELATORIO_QUERY, "Rua R, Centro, Outra Cidade, Pernambuco, Brasil");
  assert.equal(matches, false);
});

test("aceita o resultado correto do próprio município", () => {
  const matches = geocodeResultMatches(RELATORIO_QUERY, "Rua R, Zona Rural, Boa Hora, Piauí, Brasil");
  assert.equal(matches, true);
});

test("aceita quando o CEP aparece no display_name, mesmo sem candidato de cidade", () => {
  const matches = geocodeResultMatches("64108-000 Brasil", "64108-000, Boa Hora, Piauí, Brasil");
  assert.equal(matches, true);
});

test("não aprova por ausência de evidência: consulta sem UF, CEP ou cidade reconhecível reprova", () => {
  const matches = geocodeResultMatches("endereco desconhecido", "Qualquer Lugar, Outro País");
  assert.equal(matches, false);
});

test("reprova quando a UF do resultado diverge da UF da consulta", () => {
  const matches = geocodeResultMatches("Rua X, Teresina PI", "Rua X, Teresina, Maranhão, Brasil");
  assert.equal(matches, false);
});

test("identifica CEP genérico de município (terminado em 000)", () => {
  assert.equal(isWholeMunicipalityCep("64108-000"), true);
  assert.equal(isWholeMunicipalityCep("64108000"), true);
  assert.equal(isWholeMunicipalityCep("64108-100"), false);
  assert.equal(isWholeMunicipalityCep(""), false);
});
