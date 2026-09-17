import { heuristicExtractionFromText } from "./extraction.js";
import { inspectPdfImages } from "./pdfForensics.js";
import { applySourceProvenance, inspectDocumentEligibility } from "./documentEligibility.js";
import { stripPjeFooter } from "./pjeText.js";
import {
  humanYearsMonthsFromDays, parseFormattedPdfDate, parsePtDate, parsePtDateTime, plural, stripDiacritics,
} from "./format.js";

/**
 * Laudo estruturado de um contrato, a partir do texto e dos metadados já lidos.
 *
 * É a rota `POST /api/analyze` do motor de geração, sem o transporte HTTP: o
 * SaaS lê o PDF no worker da fila e chama esta função, para que a regra pericial
 * tenha um único lugar e o worker continue responsável só por crédito, slot,
 * persistência e notificação.
 *
 * @param {object} args
 * @param {Buffer} args.pdfBuffer arquivo original, usado no inventário de imagens
 * @param {{text: string}} args.extraction texto (com OCR, se aplicado)
 * @param {object} args.rawMetadata saída de `extractPdfMetadata`
 * @param {object} [args.sourceContext] proveniência declarada (ex.: fatiamento PJe)
 * @param {boolean} [args.enforceNativeDocument] recusa peça judicial como contrato
 * @returns {Promise<{extracted, metadata, eligibility, recusado: boolean}>}
 */
export async function analisarDocumento({
  pdfBuffer,
  extraction,
  rawMetadata,
  sourceContext = {},
  enforceNativeDocument = false,
}) {
  const cleanedExtraction = stripPjeFooter(extraction.text);
  const eligibility = inspectDocumentEligibility(cleanedExtraction.text, {
    sourceContext,
    requireNativeSignals: Boolean(enforceNativeDocument),
  });
  if (enforceNativeDocument && !eligibility.allowed) {
    return { extracted: null, metadata: rawMetadata, eligibility, recusado: true };
  }

  const metadata = applySourceProvenance(rawMetadata, sourceContext);
  metadata.warnings = metadata.warnings || [];
  const derivedSource = metadata.metadataAnalysisStatus === "NOT_ASSESSABLE_DERIVED";
  const imageAnalysis = await inspectPdfImages(pdfBuffer, cleanedExtraction.text);
  const fallback = heuristicExtractionFromText(cleanedExtraction.text);
  fallback.rodape_pje = cleanedExtraction.removed;
  fallback.imagens_pdf = imageAnalysis;
  fallback.achados_irregularidade = fallback.achados_irregularidade || [];

  // Achados de imagem com peso probatório entram no placar de irregularidades.
  for (const finding of imageAnalysis.achados || []) {
    if (finding.severidade === "CRÍTICO" || finding.severidade === "ALTO" || finding.severidade === "MÉDIO") {
      if (!fallback.achados_irregularidade.some((issue) => issue.codigo === finding.codigo)) {
        fallback.achados_irregularidade.push({
          codigo: finding.codigo,
          gravidade: finding.severidade === "MÉDIO" ? "MÉDIA" : finding.severidade,
          titulo: finding.titulo,
          texto: finding.detalhe,
        });
      }
    }
  }

  fallback.assinatura = fallback.assinatura || {};
  const signatureAlerts = metadata.digitalSignature?.alerts || [];

  // S5: assinatura do emissor anterior ao aceite do contratante.
  const acceptanceDate = parsePtDateTime(fallback.assinatura.data_hora_assinatura);
  if (acceptanceDate && metadata.digitalSignature?.pdfsig?.assinaturas?.length) {
    const earlier = metadata.digitalSignature.pdfsig.assinaturas.filter((sig) => {
      const sigDate = parsePtDateTime(sig.data_assinatura);
      return sigDate && sigDate < acceptanceDate;
    });
    if (earlier.length) {
      signatureAlerts.push({
        codigo: "S5",
        severidade: "CRÍTICO",
        titulo: "Assinatura anterior ao aceite",
        detalhe: `${earlier.length} assinatura(s) do emissor antecedem o aceite do contratante em ${fallback.assinatura.data_hora_assinatura}: ${earlier.map((s) => `${s.campo} ${s.data_assinatura}`).join(", ")}.`,
      });
    }
  }
  if (metadata.digitalSignature) metadata.digitalSignature.alerts = signatureAlerts;
  for (const alert of signatureAlerts) {
    const text = `${alert.codigo} ${alert.severidade}: ${alert.titulo}. ${alert.detalhe}`;
    if (!metadata.warnings.includes(text)) metadata.warnings.push(text);
  }

  fallback.assinatura.assinatura_criptografica = {
    estado: metadata.cryptographicSignatureStatus || (metadata.hasEmbeddedSignatures ? "PRESENTE" : "AUSENTE"),
    motivo: metadata.cryptographicSignatureReason || (metadata.hasEmbeddedSignatures ? "Assinatura digital incorporada detectada no catálogo do PDF." : "Assinatura digital incorporada não detectada."),
    quantidade: metadata.digitalSignature?.pdfsig?.assinaturas?.length || metadata.digitalSignature?.catalog?.fields?.filter((field) => field.assinado).length || 0,
    procedencia: metadata.digitalSignature?.procedencia,
    catalogo: metadata.digitalSignature?.catalog,
    validacao: metadata.digitalSignature?.pdfsig,
    alertas: signatureAlerts,
  };

  // Campos de certificado só valem quando há assinatura criptográfica aferível.
  if (derivedSource || (!metadata.hasEmbeddedSignatures && metadata.cryptographicSignatureStatus !== "NÃO AFERÍVEL")) {
    fallback.assinatura.algoritmo_hash = null;
    fallback.assinatura.numero_serie_certificado = null;
    fallback.assinatura.certificadora_ac = null;
  } else if (metadata.digitalSignature?.pdfsig?.assinaturas?.[0]) {
    const sig = metadata.digitalSignature.pdfsig.assinaturas[0];
    fallback.assinatura.algoritmo_hash = sig.algoritmo_resumo || fallback.assinatura.algoritmo_hash;
    fallback.assinatura.certificadora_ac = sig.signatario_dn?.match(/OU=([^,]*Autoridade Certificadora[^,]*)/)?.[1] || fallback.assinatura.certificadora_ac;
  }

  const metadataAuthor = stripDiacritics(metadata.author || "").toLowerCase();
  const clientName = stripDiacritics(fallback.cliente?.nome || "").toLowerCase();
  if (!derivedSource && metadataAuthor && clientName && !clientName.includes(metadataAuthor) && !metadataAuthor.includes(clientName)) {
    metadata.warnings.push(`O autor declarado nos metadados (${metadata.author}) difere do nome do contratante extraído (${fallback.cliente.nome}). A divergência não comprova fraude, mas deve ser contextualizada.`);
  }

  // INT2: arquivo apresentado é reimpressão muito posterior à contratação.
  const creationDate = parseFormattedPdfDate(metadata.creationDate);
  const contractDate = parsePtDate(fallback.contrato?.data_contrato);
  if (!derivedSource && creationDate && contractDate) {
    const delayDays = Math.floor((creationDate - contractDate) / 86400000);
    if (delayDays > 30) {
      const message = `Data interna de criação do PDF (${metadata.creationDate}) é ${plural(delayDays, "dia", "dias")} posterior à data do contrato (${fallback.contrato.data_contrato}), o equivalente a aproximadamente ${humanYearsMonthsFromDays(delayDays)}. O dado indica que o arquivo apresentado é reimpressão/exportação posterior; isso é lacuna de proveniência e não prova, isoladamente, adulteração do negócio.`;
      metadata.warnings.push(message);
      if (!fallback.achados_irregularidade.some((issue) => issue.codigo === "INT2")) {
        fallback.achados_irregularidade.push({
          codigo: "INT2",
          gravidade: "MÉDIA",
          titulo: "Arquivo apresentado é reimpressão posterior",
          texto: message,
        });
      }
      if (metadata.digitalSignature?.procedencia?.procedencia === "NATIVO_PROVAVEL") {
        metadata.digitalSignature.procedencia = {
          ...metadata.digitalSignature.procedencia,
          procedencia: "REIMPRESSAO_POSTERIOR_PROVAVEL",
          indicios: [...(metadata.digitalSignature.procedencia.indicios || []), "data interna posterior à contratação"],
          mensagem: "A data de criação interna do PDF é muito posterior à data do contrato; a ausência de assinatura digital deve ser lida como ausência no arquivo apresentado, não necessariamente no artefato original de contratação.",
        };
        fallback.assinatura.assinatura_criptografica.procedencia = metadata.digitalSignature.procedencia;
      }
    }
  }

  fallback.evidencias_irregularidade = fallback.achados_irregularidade.map((issue) => `${issue.titulo}. ${issue.texto}`);

  return { extracted: fallback, metadata, eligibility, recusado: false };
}
