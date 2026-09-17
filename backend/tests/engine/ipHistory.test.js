import { test } from "vitest";
import assert from "node:assert/strict";
import { classifyIpHistory, isBrazilianCarrierAsn, isLeaseMarketplaceOrg } from "../../src/engine/ipHistory.js";

// Caso real do relatório técnico de 09/09/2026 (item 7): 191.45.47.229 foi
// classificado como "Polônia, risco crítico, 8.952 km" com base no registro
// de 2026, mas em 17/10/2023 (data do ato) era anunciado pelo AS7738
// (V.tal/Oi, Brasil) segundo o histórico de roteamento do RIPEstat.
test("marca 'registro alterado após o ato' quando o ASN/RIR mudou desde a data do ato", () => {
  const result = classifyIpHistory(
    { asn: 7738, asnHolder: "Telemar Norte Leste S.A. (V.tal)", rir: "LACNIC", orgName: "V tal" },
    { asn: 61138, asnHolder: "Triathlon Trading FZCO", rir: "RIPE", orgName: "Triathlon Trading FZCO", country: "Polônia" },
  );
  assert.equal(result.status, "REGISTRO_ALTERADO_APOS_O_ATO");
  assert.equal(result.transferredAfterAct, true);
  assert.equal(result.brazilianCarrierAtDate, true);
  assert.equal(result.suppressDistanceRisk, true);
  assert.match(result.note, /V\.tal|Telemar/);
  assert.match(result.note, /Pol[oô]nia/);
});

test("reconhece ASNs de operadoras brasileiras", () => {
  assert.equal(isBrazilianCarrierAsn(7738), true);
  assert.equal(isBrazilianCarrierAsn(26599), true);
  assert.equal(isBrazilianCarrierAsn(61138), false);
});

test("identifica organizações de marketplace de aluguel de IPv4", () => {
  assert.equal(isLeaseMarketplaceOrg("IPXO LLC"), true);
  assert.equal(isLeaseMarketplaceOrg("Triathlon Trading FZCO"), true);
  assert.equal(isLeaseMarketplaceOrg("Telemar Norte Leste S.A."), false);
});

test("sem histórico disponível, não afirma nem descarta nada", () => {
  const result = classifyIpHistory(null, { asn: 61138 });
  assert.equal(result.status, "SEM_HISTORICO");
  assert.equal(result.transferredAfterAct, null);
});

test("sem transferência e sem operadora conhecida, não gera rótulo", () => {
  const result = classifyIpHistory(
    { asn: 15169, asnHolder: "Google LLC", rir: "ARIN", orgName: "Google LLC" },
    { asn: 15169, asnHolder: "Google LLC", rir: "ARIN", orgName: "Google LLC" },
  );
  assert.equal(result.status, "SEM_TRANSFERENCIA_DETECTADA");
  assert.equal(result.label, null);
});
