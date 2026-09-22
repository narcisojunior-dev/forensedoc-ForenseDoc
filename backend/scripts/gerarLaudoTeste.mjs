/**
 * Gera um laudo de teste a partir de um PDF real, pelo mesmo caminho do worker.
 *
 * Serve para avaliar o DESENHO do laudo antes de trocar o padrão do sistema: o
 * conteúdo e as regras são os mesmos da emissão normal, só o tema muda.
 *
 *   node scripts/gerarLaudoTeste.mjs <dossiê.pdf> "<endereço de referência>" \
 *     [--tema=modelo|classico] [--saida=arquivo.pdf]
 *
 * Usa rede: geocodificação do endereço (Nominatim) e geolocalização dos IPs da
 * trilha (provedor externo). Se a geografia falhar, o laudo sai sem o confronto,
 * como acontece na emissão real.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { analisarDocumento } from "../src/engine/analisarDocumento.js";
import { extractPdfMetadata } from "../src/services/pdfService.js";
import { extractPdfTextWithOcr } from "../src/services/ocrService.js";
import { enrichGeography } from "../src/services/geoEnrichmentService.js";
import { buildSummaryForResult } from "../src/services/analysisRecompute.js";
import { buildCustodyChain } from "../src/reports/custodyChain.js";
import { montarConfrontoGeografico } from "../src/utils/distancia.js";
import { verificarCoerencia, coerenciaBloqueante } from "../src/engine/coerenciaLaudo.js";
import { buildReportPdf } from "../src/services/reportPdfService.js";

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
const endereco = args.filter((a) => !a.startsWith("--"))[1] || null;
const opcao = (nome, padrao) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3) : padrao;
};

if (!arquivo) {
  console.error('uso: node scripts/gerarLaudoTeste.mjs <dossiê.pdf> "<endereço>" [--tema=modelo] [--saida=arquivo.pdf]');
  process.exit(2);
}

const tema = opcao("tema", "modelo");
const saida = opcao("saida", `laudo-teste-${tema}.pdf`);

const buffer = await readFile(arquivo);
const sha256 = createHash("sha256").update(buffer).digest("hex");
const sha1 = createHash("sha1").update(buffer).digest("hex");
console.log(`Arquivo: ${arquivo} (${(buffer.length / 1024).toFixed(2)} KB)`);
console.log(`SHA-256: ${sha256}`);

console.log("Extraindo texto e metadados (OCR quando necessário)...");
const [extraction, rawMetadata] = await Promise.all([extractPdfTextWithOcr(buffer), extractPdfMetadata(buffer)]);

console.log("Analisando pelo motor pericial...");
const analise = await analisarDocumento({ pdfBuffer: buffer, extraction, rawMetadata });
const extracted = analise.extracted;

let geo = { home: null, contractGeo: null, geoDeclaredPresent: false, ipAnalysis: [] };
if (endereco) {
  console.log(`Confronto geográfico a partir de: ${endereco}`);
  try {
    geo = await enrichGeography(extracted, endereco);
  } catch (erro) {
    console.warn(`Geografia indisponível: ${erro.message}`);
  }
}

const generatedAt = new Date().toISOString();
const result = {
  text: JSON.stringify(extracted),
  metadata: analise.metadata,
  eligibility: analise.eligibility,
  engine: { nome: "ForenseDoc motor pericial", versao: "2" },
  reportId: `FD-${generatedAt.slice(0, 10).replace(/-/g, "")}-${sha256.slice(0, 10).toUpperCase()}`,
  source: "local",
  usedOcr: extraction.usedOcr,
  ocrPages: extraction.ocrPages,
  ocrPageNumbers: extraction.ocrPageNumbers || [],
  warning: extraction.usedOcr ? `OCR aplicado automaticamente em ${extraction.ocrPages} página(s).` : "",
  hashes: { sha256, sha1 },
  file: { name: arquivo.split("/").pop(), sizeBytes: buffer.length },
  home: geo.home,
  contractGeo: geo.contractGeo,
  geoDeclaredPresent: geo.geoDeclaredPresent,
  ipAnalysis: geo.ipAnalysis,
  confronto_enderecos: geo.confronto_enderecos || null,
  cadeiaCustodia: buildCustodyChain(extracted, geo.ipAnalysis, geo.geoDeclaredPresent),
  generatedAt,
};
result.confronto_geografico = montarConfrontoGeografico(result);
result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
result.coerencia = verificarCoerencia(result, extracted);
result.coerencia_bloqueante = coerenciaBloqueante();
if (result.coerencia.length) {
  console.warn(`Coerência: ${result.coerencia.length} apontamento(s): ${result.coerencia.map((c) => c.regra).join(", ")}`);
}

console.log(`Gerando o PDF no tema "${tema}"...`);
const doc = await buildReportPdf({ id: result.reportId, createdAt: new Date() }, result, { tema });
const partes = [];
for await (const parte of doc) partes.push(parte);
const pdf = Buffer.concat(partes);
await writeFile(saida, pdf);

console.log(`\nLaudo gravado em ${saida} (${(pdf.length / 1024).toFixed(1)} KB)`);
console.log(`Achados: ${(extracted.achados_irregularidade || []).map((a) => a.codigo).join(", ") || "nenhum"}`);
console.log(`IPs geolocalizados: ${geo.ipAnalysis.filter((ip) => ip.geo).length} de ${geo.ipAnalysis.length}`);
process.exit(0);
