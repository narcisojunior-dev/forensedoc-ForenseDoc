import { extractPdfTextWithOcr } from "../services/ocrService.js";
import { extractPdfMetadata } from "../services/pdfService.js";
import { heuristicExtractionFromText } from "../services/extractionService.js";
import { cleanPdfBase64, stripDiacritics } from "../utils/stringUtils.js";

export async function analyzePdf(req, res) {
  try {
    const { pdfBase64 } = req.body || {};
    if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 ausente." });

    const pdfBuffer = Buffer.from(cleanPdfBase64(pdfBase64), "base64");
    const [extraction, metadata] = await Promise.all([
      extractPdfTextWithOcr(pdfBuffer),
      extractPdfMetadata(pdfBuffer),
    ]);
    
    const fallback = heuristicExtractionFromText(extraction.text);
    const metadataAuthor = stripDiacritics(metadata.author || "").toLowerCase();
    const clientName = stripDiacritics(fallback.cliente?.nome || "").toLowerCase();
    
    if (metadataAuthor && clientName && !clientName.includes(metadataAuthor) && !metadataAuthor.includes(clientName)) {
      metadata.warnings.push(`O autor declarado nos metadados (${metadata.author}) difere do nome do contratante extraído (${fallback.cliente.nome}). A divergência não comprova fraude, mas deve ser contextualizada.`);
    }
    
    return res.json({
      text: JSON.stringify(fallback),
      metadata,
      source: "local",
      usedOcr: extraction.usedOcr,
      ocrPages: extraction.ocrPages,
      warning: extraction.usedOcr
        ? `OCR aplicado automaticamente em ${extraction.ocrPages} página(s) antes da análise local.`
        : "",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Erro interno." });
  }
}
