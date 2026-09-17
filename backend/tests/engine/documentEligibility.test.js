import { test } from "vitest";
import assert from "node:assert/strict";
import { applySourceProvenance, inspectDocumentEligibility } from "../../src/engine/documentEligibility.js";

test("bloqueia contestação mesmo quando contém vocabulário contratual", () => {
  const text = "AO JUÍZO DA VARA CÍVEL. CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 12345. Assinado eletronicamente por: Advogado OAB/PI 1234.";
  const result = inspectDocumentEligibility(text, { requireNativeSignals: true });
  assert.equal(result.allowed, false);
  assert.ok(result.exclusions.some((item) => item.code === "JUDICIAL_ADDRESSING"));
});

test("aceita dossiê bancário com sinal positivo", () => {
  const result = inspectDocumentEligibility("Dossiê Comprobatório. CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 98765.", { requireNativeSignals: true });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.positiveSignals.sort(), ["CCB", "DOSSIER"]);
});

test("bloqueia laudo quando a seleção não demonstra vínculo com os autos", () => {
  const result = inspectDocumentEligibility("Dossiê Comprobatório. CCB Nº 98765.", {
    requireNativeSignals: true,
    sourceContext: { selection: { eligible: true, linkStatus: "not-demonstrated" } },
  });
  assert.equal(result.allowed, false);
  assert.ok(result.exclusions.some((item) => item.code === "UPSTREAM_LINK_NOT_DEMONSTRATED"));
});

test("mantém laudo quando a seleção é elegível e o vínculo foi demonstrado", () => {
  const result = inspectDocumentEligibility("Dossiê Comprobatório. CCB Nº 98765.", {
    requireNativeSignals: true,
    sourceContext: { selection: { eligible: true, linkStatus: "demonstrated" } },
  });
  assert.equal(result.allowed, true);
});

test("arquivo derivado torna metadados e assinatura não aferíveis", () => {
  const metadata = applySourceProvenance({
    producer: "pypdf", creationDate: "27/08/2026 10:00:00",
    hasEmbeddedSignatures: false, cryptographicSignatureStatus: "AUSENTE", warnings: [],
  }, { documentId: "91836121", provenance: { kind: "pje-split", derived: true, tool: "pypdf" } });
  assert.equal(metadata.metadataAnalysisStatus, "NOT_ASSESSABLE_DERIVED");
  assert.equal(metadata.creationDate, null);
  assert.equal(metadata.hasEmbeddedSignatures, null);
  assert.equal(metadata.cryptographicSignatureStatus, "NÃO AFERÍVEL");
  assert.equal(metadata.sourceProvenance.sourceDocumentId, "91836121");
});
