/**
 * Gera uma peça de teste reproduzindo o pipeline do analysisWorker SEM banco e
 * SEM fila — as mesmas funções, na mesma ordem. O que o worker faz a mais
 * (crédito, lock, notificação, persistência) não influencia o PDF.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const B = "/Users/narcisojunior/Documents/repositorios/Forense_DOC/forensedoc-ForenseDoc/backend/src";
const { extractPdfTextWithOcr } = await import(`${B}/services/ocrService.js`);
const { extractPdfMetadata } = await import(`${B}/services/pdfService.js`);
const { heuristicExtractionFromText } = await import(`${B}/services/extractionService.js`);
const { enrichGeography } = await import(`${B}/services/geoEnrichmentService.js`);
const { buildCustodyChain } = await import(`${B}/reports/custodyChain.js`);
const { buildReportPdf } = await import(`${B}/services/reportPdfService.js`);
const { stripDiacritics } = await import(`${B}/utils/stringUtils.js`);

const ENTRADA = "/Users/narcisojunior/Documents/repositorios/Forense_DOC/documentação/doc_teste/dossiê.pdf";
const SAIDA = "/Users/narcisojunior/Documents/repositorios/Forense_DOC/documentação/doc_teste/LAUDO_ForenseDoc_dossie_Manaquiri.pdf";

const HOME_ADDRESS = "Rua Solimões, S/N, Areal, CEP 69.435-000, Manaquiri – Amazonas";
const HOME_COORD = { lat: -3.434452, lon: -60.4725532 };

const pdfBuffer = await fs.readFile(ENTRADA);
const hashes = {
  sha256: crypto.createHash("sha256").update(pdfBuffer).digest("hex").toUpperCase(),
  sha1: crypto.createHash("sha1").update(pdfBuffer).digest("hex").toUpperCase(),
};

const [extraction, metadata] = await Promise.all([
  extractPdfTextWithOcr(pdfBuffer),
  extractPdfMetadata(pdfBuffer),
]);

const fallback = heuristicExtractionFromText(extraction.text);

const autor = stripDiacritics(metadata.author || "").toLowerCase();
const cliente = stripDiacritics(fallback.cliente?.nome || "").toLowerCase();
if (autor && cliente && !cliente.includes(autor) && !autor.includes(cliente)) {
  metadata.warnings.push(
    `O autor declarado nos metadados (${metadata.author}) difere do nome do contratante extraído (${fallback.cliente.nome}). A divergência não comprova fraude, mas deve ser contextualizada.`
  );
}

const geo = await enrichGeography(fallback, HOME_ADDRESS, HOME_COORD);

const result = {
  text: JSON.stringify(fallback),
  metadata,
  source: "local",
  usedOcr: extraction.usedOcr,
  ocrPages: extraction.ocrPages,
  warning: extraction.usedOcr
    ? `OCR aplicado automaticamente em ${extraction.ocrPages} página(s) antes da análise local.`
    : "",
  hashes,
  file: { name: "dossiê.pdf", sizeBytes: pdfBuffer.length },
  home: geo.home,
  contractGeo: geo.contractGeo,
  geoDeclaredPresent: geo.geoDeclaredPresent,
  ipAnalysis: geo.ipAnalysis,
  cadeiaCustodia: buildCustodyChain(fallback, geo.ipAnalysis, geo.geoDeclaredPresent),
  generatedAt: new Date().toISOString(),
};

const analysis = { id: crypto.randomUUID(), createdAt: new Date() };
const pdf = await buildReportPdf(analysis, result);
await fs.writeFile(SAIDA, pdf);

// ─── Conferência do que foi para os mapas ────────────────────────────────────
const { mapPointsIpVsHome, mapPointsHomeVsDeclared } = await import(`${B}/services/staticMapService.js`);
const fmt = (p) => (p.length ? p.map((x) => `${x.label} ${x.lat.toFixed(4)},${x.lon.toFixed(4)}`).join("  ↔  ") : "VAZIO");
console.log("\n─── mapas ───");
console.log("Mapa 1 (IP × residência):        ", fmt(mapPointsIpVsHome(result)));
console.log("Mapa 2 (residência × declarado): ", fmt(mapPointsHomeVsDeclared(result)));
console.log("\n─── confrontos ───");
console.log("residência:", result.home?.display, "|", result.home?.geo?.lat, result.home?.geo?.lon);
console.log("declarado :", result.contractGeo?.lat, result.contractGeo?.lon, "| presente:", result.geoDeclaredPresent);
for (const ip of result.ipAnalysis) {
  console.log(`IP ${ip.endereco} (v${ip.versao}${ip.porta ? ", porta " + ip.porta : ""}) rótulo=${ip.rotulo || "—"}`);
  console.log("   geo:", ip.geo ? `${ip.geo.city}/${ip.geo.region} · ${ip.geo.isp} · fonte ${ip.geo.source}` : `FALHOU (${ip.geoFailure})`);
  if (ip.divergenciaResidencia) console.log(`   × residência: ${ip.divergenciaResidencia.km.toFixed(2)} km — ${ip.divergenciaResidencia.rotulo}`);
  if (ip.divergenciaAssinatura) console.log(`   × declarado : ${ip.divergenciaAssinatura.km.toFixed(2)} km — ${ip.divergenciaAssinatura.rotulo}`);
}
console.log("\ncadeia:", result.cadeiaCustodia.presentes + "/" + result.cadeiaCustodia.total, result.cadeiaCustodia.avaliacao.rotulo);
console.log("PDF:", SAIDA, (pdf.length / 1024).toFixed(0) + " KB");
