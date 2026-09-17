// Perícia estrutural do PDF: proveniência, catálogo de assinaturas (AcroForm),
// validação criptográfica via pdfsig, inventário de imagens via pdfimages e
// metadados internos. Portado do motor de geração (backend/server.js).
import { PDFParse } from "pdf-parse";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cleanMetadataText, formatPdfDate, parseFormattedPdfDate, plural } from "./format.js";

const execFileAsync = promisify(execFile);
const PDFSIG_CANDIDATES = [process.env.PDFSIG_PATH, "pdfsig"].filter(Boolean);
const PDFIMAGES_CANDIDATES = [process.env.PDFIMAGES_PATH, "pdfimages"].filter(Boolean);

export function classifyPdfProvenance(meta) {
  const creator = String(meta.creator || "").toLowerCase();
  const producer = String(meta.producer || "").toLowerCase();
  const creation = parseFormattedPdfDate(meta.creationDate);
  const today = new Date();
  const reportEngines = ["jasperreports", "birt", "crystal reports", "dompdf", "wkhtmltopdf", "reportlab", "fpdf"];
  const signs = [];
  if (creation && (today - creation) / 86400000 <= 30) signs.push("data de criação recente");
  if (Number(meta.totalPages) > 60) signs.push("volume compatível com autos consolidados");
  if (producer.includes("itext") && !reportEngines.some((engine) => creator.includes(engine))) signs.push("produtor iText sem motor de relatório declarado");
  if (signs.length >= 2) {
    return {
      procedencia: "RE_RENDERIZACAO_JUDICIAL",
      indicios: signs,
      bloqueio: true,
      mensagem: "O arquivo examinado tem características de exportação consolidada de sistema processual. Esse tipo de arquivo é re-renderizado e não preserva assinaturas digitais, campos de formulário nem metadados nativos. A ausência de assinatura neste arquivo não significa que o documento original não possua assinatura. Examine o arquivo original baixado individualmente antes de qualquer conclusão.",
    };
  }
  return { procedencia: "NATIVO_PROVAVEL", indicios: signs, bloqueio: false };
}

function pdfObject(raw, xref) {
  const pattern = new RegExp(`(?:^|\\n)${xref}\\s+0\\s+obj\\b([\\s\\S]*?)\\bendobj`, "gm");
  const matches = Array.from(raw.matchAll(pattern));
  return matches.length ? matches[matches.length - 1][1] : "";
}

function parsePdfDateLiteral(value) {
  const match = String(value || "").match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+\-Z])?(\d{2})?'?(\d{2})?/);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}`;
}

/**
 * Número do objeto do catálogo (raiz do documento).
 *
 * O motor de geração localizava o catálogo com
 * `(\d+)\s+0\s+obj\s*<<[\s\S]*?\/Type\s*\/Catalog`, que começa a casar no
 * PRIMEIRO objeto do arquivo e avança até achar "/Type /Catalog". Quando o
 * catálogo não era o primeiro objeto, o número capturado era o do primeiro, e o
 * laudo afirmava AcroForm AUSENTE e nenhum campo de assinatura. Isso acontece
 * justamente nos PDFs assinados, em que a assinatura acrescenta um catálogo novo
 * ao fim do arquivo por atualização incremental.
 *
 * O `/Root` do trailer (ou do xref stream) é a referência autoritativa; vale a
 * última ocorrência, que é a da revisão mais recente. Sem ele, usa o objeto que
 * efetivamente contém "/Type /Catalog", também o último.
 */
function localizarCatalogo(raw) {
  const raizes = Array.from(raw.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g));
  if (raizes.length) return Number(raizes[raizes.length - 1][1]);

  let catalogo = null;
  for (const marca of raw.matchAll(/\/Type\s*\/Catalog\b/g)) {
    const antes = raw.slice(Math.max(0, marca.index - 8192), marca.index);
    const aberturas = Array.from(antes.matchAll(/(\d+)\s+\d+\s+obj\b/g));
    const abertura = aberturas[aberturas.length - 1];
    // O "N 0 obj" só é o dono da marca se não houver "endobj" entre os dois.
    if (abertura && abertura.index > antes.lastIndexOf("endobj")) catalogo = Number(abertura[1]);
  }
  return catalogo;
}

export function inspectCatalogSignatures(pdfBuffer) {
  const raw = pdfBuffer.toString("latin1");
  const eofCount = (raw.match(/%%EOF/g) || []).length;
  const startxrefCount = (raw.match(/startxref/g) || []).length;
  const catalogXref = localizarCatalogo(raw);
  const catalog = catalogXref ? pdfObject(raw, catalogXref) : "";
  const acroRef = catalog.match(/\/AcroForm\s+(\d+)\s+0\s+R/)?.[1];
  if (!acroRef) {
    return {
      acroform: "AUSENTE",
      acroformXref: null,
      sigFlags: null,
      signaturesExist: false,
      appendOnly: false,
      fields: [],
      eofCount,
      startxrefCount,
      incrementalUpdates: Math.max(0, eofCount - 1),
    };
  }
  const acroformXref = Number(acroRef);
  const acro = pdfObject(raw, acroformXref);
  const sigFlags = Number(acro.match(/\/SigFlags\s+(\d+)/)?.[1] || 0) || null;
  const fieldsRaw = acro.match(/\/Fields\s*\[([\s\S]*?)\]/)?.[1] || "";
  const fields = [];
  for (const ref of fieldsRaw.matchAll(/(\d+)\s+0\s+R/g)) {
    const xref = Number(ref[1]);
    const obj = pdfObject(raw, xref);
    if (!/\/FT\s*\/Sig|\/FT\/Sig/.test(obj)) continue;
    const rectText = obj.match(/\/Rect\s*\[([^\]]*)\]/)?.[1]?.trim() || null;
    const rectNumbers = (rectText || "").split(/\s+/).map(Number).filter(Number.isFinite);
    const sigDictXref = Number(obj.match(/\/V\s+(\d+)\s+0\s+R/)?.[1] || 0) || null;
    const sigObj = sigDictXref ? pdfObject(raw, sigDictXref) : "";
    fields.push({
      xref,
      nome: obj.match(/\/T\s*\(([^)]*)\)/)?.[1] || null,
      rect: rectText,
      invisivel: rectNumbers.length === 4 && rectNumbers.every((n) => n === 0),
      assinado: Boolean(sigDictXref),
      dicionario_sig: sigDictXref,
      data_declarada: parsePdfDateLiteral(sigObj.match(/\/M\s*\((D:[^)]*)\)/)?.[1]),
      byterange: (sigObj.match(/\/ByteRange\s*\[([^\]]+)\]/)?.[1] || "").split(/\s+/).map(Number).filter(Number.isFinite),
      subfilter: sigObj.match(/\/SubFilter\s*\/([A-Za-z0-9.]+)/)?.[1] || null,
      pkcs7BerIndefinido: /\/Contents\s*<\s*3080/i.test(sigObj),
    });
  }
  return {
    acroform: "PRESENTE",
    acroformXref,
    sigFlags,
    signaturesExist: Boolean(sigFlags && (sigFlags & 1)),
    appendOnly: Boolean(sigFlags && (sigFlags & 2)),
    fields,
    eofCount,
    startxrefCount,
    incrementalUpdates: Math.max(0, eofCount - 1),
  };
}

async function findPdfsig() {
  for (const candidate of PDFSIG_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      if (candidate === "pdfsig") return candidate;
    }
  }
  return null;
}

function parsePdfsigTime(value) {
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const match = String(value || "").match(/([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  return match ? `${String(match[2]).padStart(2, "0")}/${months[match[1]]}/${match[3]} ${match[4]}:${match[5]}:${match[6]}` : value || null;
}

function parsePdfsigOutput(output, totalBytes) {
  const signatures = [];
  let current = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    const sig = line.match(/^Signature #(\d+):/);
    if (sig) {
      if (current) signatures.push(current);
      current = { numero: Number(sig[1]), notTotalDocumentSigned: false };
      continue;
    }
    if (!current) continue;
    const item = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
    if (item) {
      const key = item[1].trim();
      const value = item[2].trim();
      if (key === "Signature Field Name") current.campo = value;
      else if (key === "Signer Certificate Common Name") current.signatario_cn = value;
      else if (key === "Signer full Distinguished Name") current.signatario_dn = value;
      else if (key === "Signing Time") current.data_assinatura = parsePdfsigTime(value);
      else if (key === "Signing Hash Algorithm") current.algoritmo_resumo = value;
      else if (key === "Signature Type") current.subfilter = value;
      else if (key === "Signed Ranges") {
        current.signedRanges = Array.from(value.matchAll(/\[(\d+)\s*-\s*(\d+)\]/g)).map((m) => [Number(m[1]), Number(m[2])]);
        current.bytesCobertos = current.signedRanges.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
        current.coberturaPercentual = totalBytes ? Number(((current.bytesCobertos / totalBytes) * 100).toFixed(2)) : null;
      } else if (key === "Signature Validation") current.validacao_assinatura = value.replace(/\.$/, "");
      else if (key === "Certificate Validation") current.validacao_certificado = value.replace(/\.$/, "");
    } else if (/Not total document signed/i.test(line)) {
      current.notTotalDocumentSigned = true;
    }
  }
  if (current) signatures.push(current);
  return signatures;
}

export async function validateWithPdfsig(pdfBuffer) {
  const pdfsig = await findPdfsig();
  if (!pdfsig) return { disponivel: false, assinaturas: [], motivo: "pdfsig não localizado no ambiente." };
  const tempDir = await mkdtemp(join(tmpdir(), "forensedoc-pdfsig-"));
  try {
    const pdfPath = join(tempDir, "input.pdf");
    await writeFile(pdfPath, pdfBuffer);
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync(pdfsig, [pdfPath], { maxBuffer: 1024 * 1024 * 20, timeout: 120000 });
      stdout = result.stdout || "";
      stderr = result.stderr || "";
    } catch (e) {
      stdout = e.stdout || "";
      stderr = e.stderr || "";
    }
    return { disponivel: true, assinaturas: parsePdfsigOutput(stdout, pdfBuffer.length), stderr: stderr.trim() || null };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function findPdfimages() {
  for (const candidate of PDFIMAGES_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      if (candidate === "pdfimages") return candidate;
    }
  }
  return null;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function parsePdfimagesList(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^page\s+num\s+type/i.test(trimmed) || /^-+/.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 10 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) continue;
    const [page, num, type, width, height, color, comp, bpc, enc, interp, objectId, generation, xPpi, yPpi, size, ratio] = parts;
    rows.push({
      page: Number(page),
      num: Number(num),
      type,
      width: Number(width),
      height: Number(height),
      color,
      comp: Number(comp),
      bpc: Number(bpc),
      enc,
      interp,
      size,
      ratio: ratio || null,
      objectId: objectId || null,
      generation: generation || null,
      xPpi: Number(xPpi) || null,
      yPpi: Number(yPpi) || null,
      pixels: Number(width) * Number(height),
    });
  }
  return rows;
}

function parseByteSize(value) {
  const match = String(value || "").match(/^([\d.]+)([KMG]?B?)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = match[2].toUpperCase();
  if (unit.startsWith("G")) return Math.round(n * 1024 * 1024 * 1024);
  if (unit.startsWith("M")) return Math.round(n * 1024 * 1024);
  if (unit.startsWith("K")) return Math.round(n * 1024);
  return Math.round(n);
}

function isLikelyFaceOrBiometricImage(image) {
  if (!image?.width || !image?.height) return false;
  const ratio = image.width / image.height;
  return ratio >= 0.45 && ratio <= 2.25 && image.width >= 180 && image.height >= 180 && image.pixels >= 50000;
}

function classifyEmbeddedImage(image) {
  if (!image?.width || !image?.height) return "desconhecida";
  const ratio = image.width / image.height;
  const bytes = parseByteSize(image.size);
  if (image.type === "smask") return "máscara alfa";
  if (image.height <= 45 && image.width >= 180) return "linha gráfica/separador do template";
  if (image.width <= 220 && image.height <= 80) return "logotipo/template";
  if (bytes !== null && bytes < 1000 && image.height <= 80) return "elemento gráfico do template";
  if (isLikelyFaceOrBiometricImage(image)) return "fotografia/biometria provável";
  if (ratio > 4 || ratio < 0.25) return "elemento gráfico/template";
  return "imagem documental";
}

function isTemplateGraphic(image) {
  const kind = classifyEmbeddedImage(image);
  return /template|logotipo|c[oó]digo|linha gr[aá]fica|m[aá]scara/.test(kind);
}

function buildImageFindings(images, repeatedGroups, extractedCount, available, options = {}) {
  const findings = [];
  if (!available) {
    findings.push({
      codigo: "IMG0",
      severidade: "INDETERMINADO",
      titulo: "pdfimages indisponível",
      detalhe: "A rotina de imagens não pôde ser executada porque o utilitário pdfimages não foi localizado no ambiente.",
    });
    return findings;
  }
  if (!images.length) {
    findings.push({
      codigo: "IMG1",
      severidade: "ATENÇÃO",
      titulo: "Nenhuma imagem embutida listada",
      detalhe: "O PDF não apresentou imagens extraíveis por pdfimages. Se houver selfie visível, ela pode estar achatada em página renderizada ou exigir exame visual complementar.",
    });
    return findings;
  }
  const biometricImages = images.filter((img) => img.classificacao === "fotografia/biometria provável");
  const relevantRepeatedGroups = repeatedGroups.filter((group) => (group.imagens || []).some((img) => img.biometricaProvavel));
  if (!biometricImages.length) {
    findings.push({
      codigo: "IMG0",
      severidade: options.biometryMentioned ? "MÉDIO" : "INFO",
      titulo: "Ausência de captura biométrica ou fotográfica",
      detalhe: `Foram inventariadas ${plural(images.length, "imagem", "imagens")}, sem fotografia, selfie ou imagem de documento capturada. ${options.biometryMentioned ? "O clausulado menciona biometria/prova visual como meio possível de manifestação de vontade, mas o PDF não apresenta registro visual correspondente." : "As imagens encontradas aparentam ser elementos gráficos do template."}`,
    });
  }
  if (relevantRepeatedGroups.length) {
    findings.push({
      codigo: "IMG2",
      severidade: "CRÍTICO",
      titulo: "Imagem repetida byte a byte",
      detalhe: `${plural(relevantRepeatedGroups.length, "grupo", "grupos")} de imagens biométricas prováveis possuem o mesmo SHA-256. Quando a mesma imagem aparece como identificação e prova de vida, a vivacidade não fica demonstrada pelo PDF.`,
    });
  } else if (repeatedGroups.length) {
    findings.push({
      codigo: "IMG2",
      severidade: "INFO",
      titulo: "Reuso de imagem de template",
      detalhe: `${plural(repeatedGroups.length, "grupo repetido", "grupos repetidos")} parecem ser logotipo, linha gráfica, máscara ou elemento gráfico do template. Não foi gerado alerta biométrico por esse reuso.`,
    });
  }
  const tiny = biometricImages.filter((img) => {
    if (!img.width || !img.height) return false;
    return img.width < 240 || img.height < 240 || img.pixels < 60000;
  });
  if (tiny.length && options.biometryMentioned) {
    findings.push({
      codigo: "IMG3",
      severidade: "ALTO",
      titulo: "Imagem com resolução insuficiente para biometria robusta",
      detalhe: `${plural(tiny.length, "imagem possui", "imagens possuem")} dimensão inferior a 240 px em algum eixo ou menos de 60.000 pixels. Esse material é frágil para comparação facial sem laudo técnico do fornecedor.`,
    });
  }
  const verySmall = images.filter((img) => {
    const bytes = parseByteSize(img.size);
    return bytes !== null && bytes < 8000 && !isTemplateGraphic(img);
  });
  if (verySmall.length) {
    findings.push({
      codigo: "IMG4",
      severidade: "MÉDIO",
      titulo: "Arquivo de imagem muito pequeno",
      detalhe: `${plural(verySmall.length, "imagem tem", "imagens têm")} menos de 8 KB conforme pdfimages, indício de baixa qualidade ou miniatura.`,
    });
  }
  if (extractedCount < images.length) {
    findings.push({
      codigo: "IMG5",
      severidade: "ATENÇÃO",
      titulo: "Nem todas as imagens foram extraídas para hash",
      detalhe: `pdfimages listou ${plural(images.length, "imagem", "imagens")}, mas apenas ${plural(extractedCount, "arquivo foi extraído", "arquivos foram extraídos")} para cálculo de SHA-256.`,
    });
  }
  return findings;
}

export async function inspectPdfImages(pdfBuffer, rawText = "") {
  const pdfimages = await findPdfimages();
  if (!pdfimages) {
    return {
      disponivel: false,
      total: 0,
      imagens: [],
      grupos_repetidos: [],
      achados: buildImageFindings([], [], 0, false),
      observacao: "pdfimages não localizado no ambiente.",
    };
  }
  const tempDir = await mkdtemp(join(tmpdir(), "forensedoc-images-"));
  try {
    const pdfPath = join(tempDir, "input.pdf");
    const prefix = join(tempDir, "img");
    await writeFile(pdfPath, pdfBuffer);
    let listOutput = "";
    try {
      const list = await execFileAsync(pdfimages, ["-list", pdfPath], { maxBuffer: 1024 * 1024 * 20, timeout: 120000 });
      listOutput = list.stdout || "";
    } catch (e) {
      listOutput = e.stdout || "";
    }
    const images = parsePdfimagesList(listOutput);
    try {
      await execFileAsync(pdfimages, ["-all", pdfPath, prefix], { maxBuffer: 1024 * 1024 * 80, timeout: 120000 });
    } catch {
      // A listagem ainda é útil mesmo quando algum formato não é exportado.
    }
    const files = (await readdir(tempDir))
      .filter((file) => /^img-\d+/.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const extracted = [];
    for (const file of files) {
      const data = await readFile(join(tempDir, file));
      extracted.push({ file, sha256: sha256Buffer(data), bytes: data.length });
    }
    images.forEach((image, index) => {
      image.classificacao = classifyEmbeddedImage(image);
      image.biometricaProvavel = image.classificacao === "fotografia/biometria provável";
      const match = extracted[index];
      if (match) {
        image.sha256 = match.sha256;
        image.extractedFile = match.file;
        image.extractedBytes = match.bytes;
      }
    });
    const groups = new Map();
    for (const image of images) {
      if (!image.sha256) continue;
      if (!groups.has(image.sha256)) groups.set(image.sha256, []);
      groups.get(image.sha256).push(image);
    }
    const repeatedGroups = Array.from(groups.entries())
      .filter(([, group]) => group.length > 1)
      .map(([sha256, group]) => ({
        sha256,
        ocorrencias: group.length,
        paginas: group.map((img) => img.page),
        imagens: group.map((img) => ({
          page: img.page,
          num: img.num,
          objectId: img.objectId,
          width: img.width,
          height: img.height,
          size: img.size,
          classificacao: img.classificacao,
          biometricaProvavel: img.biometricaProvavel,
        })),
      }));
    const biometryMentioned = /biometr|selfie|prova\s+de\s+vida|facial|vivacidade|liveness/i.test(rawText);
    return {
      disponivel: true,
      total: images.length,
      extraidas: extracted.length,
      imagens: images,
      grupos_repetidos: repeatedGroups,
      achados: buildImageFindings(images, repeatedGroups, extracted.length, true, { biometryMentioned }),
      observacao: "Imagens listadas por pdfimages. Hashes individuais calculados sobre os arquivos extraídos por Poppler.",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildSignatureAlerts(catalog, pdfsigResult) {
  const alerts = [];
  const signatures = pdfsigResult.assinaturas || [];
  const add = (codigo, severidade, titulo, detalhe) => alerts.push({ codigo, severidade, titulo, detalhe });
  const expired = signatures.filter((s) => /expired/i.test(s.validacao_certificado || ""));
  if (expired.length) add("S1", "CRÍTICO", "Assinatura com certificado expirado", `${expired.length} assinatura(s) indicam certificado expirado na validação.`);
  const digestMismatch = signatures.filter((s) => /digest mismatch/i.test(s.validacao_assinatura || ""));
  if (digestMismatch.length) add("S2", "CRÍTICO", "Digest mismatch", `${digestMismatch.length} assinatura(s) falham por divergência de resumo criptográfico: ${digestMismatch.map((s) => s.campo).join(", ")}.`);
  const notTotal = signatures.filter((s) => s.notTotalDocumentSigned);
  if (notTotal.length) add("S3", "ALTO", "Assinatura parcial", `${notTotal.length} assinatura(s) não cobrem o documento inteiro.`);
  const institutionSigner = signatures.filter((s) => /agibank|banco/i.test(s.signatario_cn || ""));
  if (institutionSigner.length) add("S4", "ALTO", "Signatário é a instituição", `Signatário identificado como ${institutionSigner[0].signatario_cn}; não é o contratante.`);
  const dummy = (catalog.fields || []).filter((f) => /dummy|test|teste|sample|exemplo|field\d+|campo\d+/i.test(f.nome || ""));
  if (dummy.length) add("S6", "MÉDIO", "Campo com nome de desenvolvimento", `Campos: ${dummy.map((f) => f.nome).join(", ")}.`);
  if (catalog.incrementalUpdates > 1) add("S7", "MÉDIO", "Atualizações incrementais múltiplas", `${catalog.incrementalUpdates} atualizações incrementais detectadas (${catalog.eofCount} marcas %%EOF).`);
  if (signatures.length) add("S8", "MÉDIO", "Carimbo RFC 3161 não confirmado", "Carimbo de tempo independente não foi confirmado pela varredura automática; conferir em validador dedicado.");
  return alerts;
}

export async function inspectDigitalSignatures(pdfBuffer, meta) {
  const procedencia = classifyPdfProvenance(meta);
  const catalog = inspectCatalogSignatures(pdfBuffer);
  if (procedencia.bloqueio) {
    return {
      procedencia,
      catalog,
      estado: "NÃO AFERÍVEL",
      motivo: procedencia.mensagem,
      pdfsig: { disponivel: false, assinaturas: [] },
      alerts: [{ codigo: "PJE", severidade: "CRÍTICO", titulo: "Arquivo re-renderizado", detalhe: procedencia.mensagem }],
    };
  }
  const pdfsig = await validateWithPdfsig(pdfBuffer);
  const alerts = buildSignatureAlerts(catalog, pdfsig);
  const signedCount = Math.max(catalog.fields.filter((f) => f.assinado).length, pdfsig.assinaturas.length);
  return {
    procedencia,
    catalog,
    estado: signedCount ? (alerts.some((a) => a.severidade === "CRÍTICO") ? "PRESENTE, COM RESSALVAS GRAVES" : "PRESENTE") : "AUSENTE",
    motivo: signedCount ? `${signedCount} campo(s)/assinatura(s) digital(is) detectado(s) pelo catálogo/PDFSig.` : "Nenhum campo de assinatura digital detectado no catálogo.",
    pdfsig,
    alerts,
  };
}

export async function extractPdfMetadata(pdfBuffer) {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getInfo({ parsePageInfo: true });
    const info = result.info || {};
    const pageFormats = Array.from(new Set((result.pages || []).map((page) => {
      const widthMm = Number(page.width) * 25.4 / 72;
      const heightMm = Number(page.height) * 25.4 / 72;
      return `${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm`;
    })));
    const warnings = [];
    const producer = cleanMetadataText(info.Producer);
    if (!info.Title) warnings.push("Título interno do PDF não informado.");
    if (!info.Author) warnings.push("Autor interno do PDF não informado.");
    if (!info.CreationDate) warnings.push("Data de criação interna não informada.");
    if (/print\s+to\s+pdf|imprimir\s+para\s+pdf/i.test(producer || "")) {
      warnings.push("O produtor indica impressão para PDF; esse processo pode achatar camadas, formulários e assinaturas digitais do arquivo de origem.");
    }
    const baseMeta = {
      version: cleanMetadataText(info.PDFFormatVersion),
      title: cleanMetadataText(info.Title),
      author: cleanMetadataText(info.Author),
      subject: cleanMetadataText(info.Subject),
      keywords: cleanMetadataText(info.Keywords),
      creator: cleanMetadataText(info.Creator),
      producer,
      creationDate: formatPdfDate(info.CreationDate),
      modificationDate: formatPdfDate(info.ModDate),
      language: cleanMetadataText(info.Language),
      totalPages: result.total || (result.pages || []).length,
      pageFormats,
      encrypted: Boolean(info.EncryptFilterName),
      encryptionFilter: cleanMetadataText(info.EncryptFilterName),
      linearized: Boolean(info.IsLinearized),
      hasXfa: Boolean(info.IsXFAPresent),
      trailerFingerprint: cleanMetadataText(result.fingerprints?.[0]),
    };
    const digitalSignature = await inspectDigitalSignatures(pdfBuffer, baseMeta);
    const hasAcroForm = digitalSignature.catalog.acroform === "PRESENTE";
    const hasEmbeddedSignatures = digitalSignature.estado !== "AUSENTE" && digitalSignature.estado !== "NÃO AFERÍVEL";
    if (!hasEmbeddedSignatures) {
      warnings.push(digitalSignature.estado === "NÃO AFERÍVEL" ? digitalSignature.motivo : "A estrutura interna do PDF não contém assinatura digital incorporada detectável no catálogo.");
    }
    if (hasAcroForm || info.IsXFAPresent) {
      warnings.push("O arquivo contém formulário interativo; campos podem ter sido preenchidos ou alterados após a criação inicial.");
    }
    for (const alert of digitalSignature.alerts || []) {
      warnings.push(`${alert.codigo} ${alert.severidade}: ${alert.titulo}. ${alert.detalhe}`);
    }

    return {
      ...baseMeta,
      hasAcroForm,
      hasEmbeddedSignatures,
      cryptographicSignatureStatus: digitalSignature.estado,
      cryptographicSignatureReason: digitalSignature.motivo,
      digitalSignature,
      warnings,
    };
  } finally {
    await parser.destroy();
  }
}
