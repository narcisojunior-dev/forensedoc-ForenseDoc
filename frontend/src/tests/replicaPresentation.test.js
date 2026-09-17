import { test } from "vitest";
import assert from "node:assert/strict";
import { presentReplicaDocument } from "../utils/replicaPresentation.js";

test("qualifica documento derivado, origem, páginas e os dois resumos", () => {
  const result = presentReplicaDocument({
    arquivo_original: "autos.pdf", sha256: "texto123", paginas_origem: [5, 6],
    proveniencia: { kind: "pje-text-split", derived: true },
  }, { documents: [{ originalName: "autos.pdf", sha256: "pdf456" }] });
  assert.equal(result.derived, true);
  assert.equal(result.origin, "texto extraído e separado do caderno do PJe");
  assert.equal(result.digestLabel, "resumo do texto derivado");
  assert.equal(result.sourceDigest, "pdf456");
  assert.equal(result.pageLabel, "páginas 5–6 do caderno original");
});

test("arquivo original não é rotulado como derivado", () => {
  const result = presentReplicaDocument({
    sha256: "arquivo123", proveniencia: { kind: "original-upload", derived: false },
  });
  assert.equal(result.derived, false);
  assert.equal(result.digestLabel, "hash do arquivo enviado");
  assert.equal(result.sourceDigest, null);
});
