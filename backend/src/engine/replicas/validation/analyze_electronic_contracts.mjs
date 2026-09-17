import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(".");
const RESULTS = resolve("backend/modules/replicas/validation/results");
const batch = JSON.parse(await readFile(resolve(RESULTS, "batch-results.json"), "utf8"));
const outputDir = resolve(RESULTS, "forensedoc-reports");
await mkdir(outputDir, { recursive: true });

const manifest = [];
const electronicCases = batch.cases.filter((item) => item.requiresForenseDocReport);
for (const [index, item] of electronicCases.entries()) {
  const stored = item.electronicDocumentsSaved?.[0];
  if (!stored) {
    manifest.push({ case: item.case, status: "missing-contract-pdf" });
    continue;
  }
  const pdfPath = resolve(ROOT, stored);
  const pdf = await readFile(pdfPath);
  const selected = item.nativeDocumentSelection?.selected;
  if (selected?.linkStatus !== "demonstrated") {
    manifest.push({
      case: item.case,
      status: "skipped-no-case-link",
      sourceContract: pdfPath,
      reason: "O documento bancário selecionado não demonstrou vínculo com estes autos. O laudo não foi emitido para não periciar documento que pode não pertencer ao contrato discutido.",
    });
    continue;
  }
  const electronic = item.electronicContractDocuments?.find((document) => document.id === selected?.id);
  const sourceContext = {
    caseNumber: item.case,
    documentId: selected?.id || null,
    documentRole: selected?.predictedType || null,
    selection: selected || null,
    provenance: electronic?.provenance || {
      kind: "pje-split", derived: true, tool: "pypdf",
      nativeMetadataAssessable: false, cryptographicSignatureAssessable: false,
    },
  };
  process.stdout.write(`[${String(index + 1).padStart(2, "0")}/${electronicCases.length}] ${item.case}\n`);
  const response = await fetch("http://127.0.0.1:8787/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pdfBase64: pdf.toString("base64"), sourceContext, enforceNativeDocument: true,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    manifest.push({ case: item.case, status: "error", error: result.error || `HTTP ${response.status}` });
    continue;
  }
  const extracted = JSON.parse(result.text || "{}");
  const report = {
    case: item.case,
    sourceContract: pdfPath,
    sourceProcess: item.source,
    sourceDocumentId: selected?.id || null,
    sourceDocumentType: selected?.predictedType || null,
    sourceSelection: selected || null,
    sourceProvenance: sourceContext.provenance,
    sha256: createHash("sha256").update(pdf).digest("hex").toUpperCase(),
    sizeBytes: pdf.length,
    generatedAt: new Date().toISOString(),
    usedOcr: result.usedOcr,
    ocrPages: result.ocrPages,
    warning: result.warning,
    metadata: result.metadata,
    eligibility: result.eligibility,
    extracted,
    status: "technical-report-pending-human-review",
    readyForFiling: false,
  };
  const output = resolve(outputDir, `${item.case}.json`);
  await writeFile(output, JSON.stringify(report, null, 2));
  manifest.push({
    case: item.case, status: "ok", output, sourceContract: pdfPath,
    usedOcr: result.usedOcr, ocrPages: result.ocrPages,
    findings: extracted.achados_irregularidade?.length || 0,
  });
}

await writeFile(resolve(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
