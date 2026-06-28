import { PDFParse } from "pdf-parse";
import { cleanPdfBase64, cleanMetadataText, formatPdfDate } from "../utils/stringUtils.js";

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
    if (!info.IsSignaturesPresent) {
      warnings.push("A estrutura interna do PDF não contém assinatura digital incorporada detectável. Isso não exclui assinatura eletrônica registrada apenas no conteúdo ou na trilha de auditoria.");
    }
    if (info.IsAcroFormPresent || info.IsXFAPresent) {
      warnings.push("O arquivo contém formulário interativo; campos podem ter sido preenchidos ou alterados após a criação inicial.");
    }

    return {
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
      hasAcroForm: Boolean(info.IsAcroFormPresent),
      hasXfa: Boolean(info.IsXFAPresent),
      hasEmbeddedSignatures: Boolean(info.IsSignaturesPresent),
      trailerFingerprint: cleanMetadataText(result.fingerprints?.[0]),
      warnings,
    };
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfText(pdfBase64) {
  const buffer = Buffer.isBuffer(pdfBase64) ? pdfBase64 : Buffer.from(cleanPdfBase64(pdfBase64), "base64");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result.text || "").replace(/\u0000/g, " ").trim();
  } finally {
    await parser.destroy();
  }
}
