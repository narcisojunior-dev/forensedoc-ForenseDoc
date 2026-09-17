import { test } from "vitest";
import assert from "node:assert/strict";
import { analyzeReplicaDocuments, buildReplicaDraft } from "../../src/engine/replicas/index.js";
import { makeSearchablePdf } from "../helpers/pdfDeTeste.js";

test("recusa análise sem documentos", async () => {
  await assert.rejects(() => analyzeReplicaDocuments([]), /ao menos um documento/);
});

test("recusa minuta sem revisão humana", async () => {
  await assert.rejects(() => buildReplicaDraft({ letter: "A" }), /revisão humana/);
});

test("monta minuta revisável após confirmação humana", async () => {
  const result = await buildReplicaDraft({
    reviewConfirmed: true, letter: "A", caseData: {}, preliminaries: [],
    analysis: { documentos: [{ tipo: "inicial" }, { tipo: "contestacao" }, { tipo: "contrato" }] },
  });
  assert.equal(result.status, "draft");
  assert.equal(result.readyForFiling, false);
  assert.ok(result.paragraphs.length > 10);
  assert.ok(result.pendingPlaceholders > 0);
});

test("bloqueia minuta quando falta inicial ou contestação", async () => {
  await assert.rejects(() => buildReplicaDraft({
    reviewConfirmed: true, letter: "A", caseData: {}, preliminaries: [],
    analysis: { documentos: [{ tipo: "contrato" }, { tipo: "log" }] },
  }), /petição inicial.*contestação|contestação.*petição inicial/);
});

test("analisa texto e preserva trilha de custódia", async () => {
  const text = "PETIÇÃO INICIAL processo 0000000-00.2026.8.18.0000 em face de BANCO TESTE S.A.";
  const result = await analyzeReplicaDocuments([{ name: "inicial.txt", base64: Buffer.from(text).toString("base64") }], { ocr: false });
  assert.equal(result.review.status, "pending");
  assert.equal(result.custody.originalsModified, false);
  assert.equal(result.custody.documents.length, 1);
  assert.match(result.custody.documents[0].sha256, /^[a-f0-9]{64}$/);
});

test("seleciona o instrumento nativo e bloqueia a contestação como contrato", async () => {
  const encode = (text) => Buffer.from(text).toString("base64");
  const result = await analyzeReplicaDocuments([
    {
      name: "inicial.txt",
      base64: encode("AO JUÍZO DA VARA CÍVEL. PETIÇÃO INICIAL de AUTORA TESTE em face de BANCO TESTE S.A. Contrato nº 123456."),
    },
    {
      name: "contestacao.txt",
      base64: encode("AO JUÍZO DA VARA CÍVEL. BANCO TESTE apresenta CONTESTAÇÃO. CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 123456, custo efetivo total e valor liberado. Assinado eletronicamente por: ADVOGADO OAB/PI 1234."),
    },
    {
      name: "ccb-eletronica.txt",
      base64: encode("Dossiê Comprobatório. CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 123456. Assinatura eletrônica por biometria facial. DATA E HORA DE ENVIO (UTC)."),
    },
  ], { ocr: false });
  assert.equal(result.nativeDocumentSelection.status, "selected");
  assert.equal(result.nativeDocumentSelection.selected.originalName, "ccb-eletronica.txt");
  assert.equal(result.nativeDocumentSelection.selected.electronic, true);
  assert.equal(result.nativeDocumentSelection.selected.path, undefined);
});

test("separa autos PJe em PDF e gera réplica com inicial e contestação", async () => {
  const pdf = makeSearchablePdf([
    "Num. 100001 - Pag. 1 PETICAO INICIAL ACAO DECLARATORIA DE INEXISTENCIA DOS PEDIDOS REQUER A CITACAO",
    "Num. 100002 - Pag. 1 BANCO TESTE VEM APRESENTAR CONTESTACAO PRELIMINAR REQUER A IMPROCEDENCIA",
    "Num. 100003 - Pag. 1 CEDULA DE CREDITO BANCARIO CCB CUSTO EFETIVO TOTAL VALOR LIBERADO TAXA DE JUROS",
  ]);
  const result = await analyzeReplicaDocuments([
    { name: "processo-consolidado.pdf", base64: pdf.toString("base64") },
  ], { ocr: false });

  assert.equal(result.custody.preprocessing.logicalDocuments, 3);
  assert.ok(result.analysis.documentos.some((document) => document.tipo === "inicial"));
  assert.ok(result.analysis.documentos.some((document) => document.tipo === "contestacao"));
  assert.ok(result.analysis.documentos.every((document) => document.arquivo_original === "processo-consolidado.pdf"));
  assert.deepEqual(result.analysis.documentos.map((document) => document.paginas_origem), [[1], [2], [3]]);
  assert.ok(result.custody.preprocessing.documents.every((document) => {
    const provenance = document.provenance || {};
    return ["kind", "derived", "tool", "nativeMetadataAssessable", "cryptographicSignatureAssessable"]
      .every((key) => Object.hasOwn(provenance, key));
  }));
  const fileLevelCodes = new Set([
    "SIG-01", "SIG-02", "SIG-03", "META-01", "META-02", "META-03", "META-04",
    "IMG-01", "IMG-02", "FNT-01", "HSH-01",
  ]);
  assert.ok(result.signals.every((signal) => !fileLevelCodes.has(signal.codigo)));
  assert.deepEqual(new Set(result.suppressedChecks.map((item) => item.codigo)), fileLevelCodes);

  const draft = await buildReplicaDraft({
    reviewConfirmed: true,
    letter: result.candidates[0].letra,
    caseData: result.analysis.dados,
    preliminaries: (result.analysis.preliminares || []).map((item) => item.cod),
    conformity: result.analysis.conformidade69 || [],
    analysis: result.analysis,
  });
  assert.equal(draft.status, "draft");
  assert.ok(draft.paragraphs.length > 10);
});

test("mantém PDF comum multipágina como um único documento lógico", async () => {
  const pdf = makeSearchablePdf([
    "CEDULA DE CREDITO BANCARIO CCB NUMERO 123456 CUSTO EFETIVO TOTAL",
    "VALOR LIBERADO TAXA DE JUROS PRAZO PARCELAS CONTRATANTE MUTUARIO",
  ]);
  const result = await analyzeReplicaDocuments([
    { name: "contrato-completo.pdf", base64: pdf.toString("base64") },
  ], { ocr: false });

  assert.equal(result.custody.preprocessing.logicalDocuments, 1);
  assert.equal(result.analysis.documentos.length, 1);
  assert.equal(result.analysis.documentos[0].paginas, 2);
  assert.deepEqual(result.analysis.documentos[0].paginas_origem, [1, 2]);
});
