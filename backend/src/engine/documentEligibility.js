const CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
const JUDICIAL_ROLES = new Set([
  "inicial", "contestacao", "replica", "jurisprudencia", "decisao",
  "sentenca", "acordao", "despacho",
]);

const NATIVE_SIGNALS = [
  ["DOSSIER", /dossi[eê]\s+comprobat[oó]rio/i],
  ["PROCESS_UUID", /identificador\s+processo[^\n]{0,80}\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["DECLARED_HASH", /(?:resumo\(?s?\)?\s+acordo|hash\s+do\s+documento|sha-?256)[^\n]{0,120}\b[0-9a-f]{64}\b/i],
  ["CCB", /c[eé]dula\s+de\s+cr[eé]dito\s+banc[aá]rio|\bCCB\s*(?:n[ºo°.]*)?\s*[:#-]?\s*[A-Z0-9]/i],
  ["AUDIT_TRAIL", /rastreabilidade\s+de\s+acesso|trilha\s+de\s+auditoria/i],
  ["UTC_SEND", /data\s+e\s+hora\s+de\s+envio\s*\(UTC\)/i],
  ["CET", /planilha\s+CET|simula[cç][aã]o\s+de\s+cr[eé]dito/i],
  ["GENERIC_TERMS", /regulamento\s+do\s+cart[aã]o|condi[cç][oõ]es\s+gerais/i],
];

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function inspectDocumentEligibility(text, { sourceContext = {}, requireNativeSignals = false } = {}) {
  const value = String(text || "");
  const first = value.slice(0, 1600);
  const firstPages = value.slice(0, 14000);
  const exclusions = [];
  const add = (code, reason) => {
    if (!exclusions.some((item) => item.code === code)) exclusions.push({ code, reason });
  };
  const role = String(sourceContext.documentRole || sourceContext.selection?.predictedType || "").toLowerCase();

  if (JUDICIAL_ROLES.has(role)) add("KNOWN_JUDICIAL_DOCUMENT", "O documento já está classificado como peça judicial.");
  if (/\b(?:AO\s+JU[IÍ]ZO|AO\s+DOUTO|EXCELENT[IÍ]SSIMO|MM\.?\s*JU[IÍ]ZO|AO\s+JUIZO\s+DE\s+DIREITO|EGR[EÉ]GIO|COLENDA)\b/i.test(first)) {
    add("JUDICIAL_ADDRESSING", "Endereçamento judicial localizado no início do documento.");
  }
  if (/assinado\s+eletronicamente\s+por\s*:?[^\n]{0,180}(?:\n[^\n]{0,180})?\bOAB\b/i.test(value)) {
    add("LAWYER_SIGNATURE", "Assinatura eletrônica vinculada a inscrição na OAB.");
  }
  if (/\b(?:TRIBUNAL\s+DE\s+JUSTI[CÇ]A|C[AÂ]MARA\s+ESPECIALIZADA|APELA[CÇ][AÃ]O\s+C[IÍ]VEL|AC[ÓO]RD[AÃ]O|DESEMBARGADOR(?:A)?|RELATOR(?:A)?)\b/i.test(firstPages)) {
    add("COURT_HEADER", "Cabeçalho, órgão ou autoridade judicial localizado.");
  }
  if (/PJe\s*-\s*Processo\s+Judicial\s+Eletr[oô]nico/i.test(firstPages)
      && /\bClasse\s*:/i.test(firstPages) && /[ÓO]rg[aã]o\s+julgador\s*:/i.test(firstPages)) {
    add("PJE_COVER", "Capa de autuação do PJe.");
  }
  const currentCase = digits(sourceContext.caseNumber);
  if (currentCase) {
    const foreign = Array.from(firstPages.matchAll(CNJ), (match) => match[0]).find((number) => digits(number) !== currentCase);
    if (foreign) add("FOREIGN_CASE_NUMBER", `Número CNJ diverso nas primeiras páginas: ${foreign}.`);
  }
  if (sourceContext.selection && sourceContext.selection.eligible !== true) {
    add("UPSTREAM_SELECTION_REJECTED", "O seletor de documentos do processo não aprovou este arquivo.");
  }
  if (requireNativeSignals && sourceContext.selection
      && sourceContext.selection.linkStatus !== "demonstrated") {
    add("UPSTREAM_LINK_NOT_DEMONSTRATED", "O documento selecionado não demonstrou vínculo material com estes autos.");
  }

  const positiveSignals = NATIVE_SIGNALS.filter(([, pattern]) => pattern.test(value)).map(([code]) => code);
  if (requireNativeSignals && !positiveSignals.length) {
    add("NO_NATIVE_SIGNAL", "Nenhum sinal positivo de instrumento bancário nativo foi localizado.");
  }
  return { allowed: exclusions.length === 0, exclusions, positiveSignals };
}

export function applySourceProvenance(metadata, sourceContext = {}) {
  const provenance = sourceContext.provenance || {};
  if (!provenance.derived) {
    return {
      ...metadata,
      metadataAnalysisStatus: "ASSESSABLE",
      sourceProvenance: { kind: provenance.kind || "user-supplied", derived: false },
    };
  }

  const reason = "O arquivo examinado é derivado de fatiamento ou re-renderização do caderno PJe. Metadados internos, data de criação e ausência de assinatura criptográfica pertencem ao arquivo derivado e não permitem conclusão sobre o documento bancário nativo.";
  const derivedFileTechnicalData = {
    producer: metadata.producer || null,
    creator: metadata.creator || null,
    creationDate: metadata.creationDate || null,
    modificationDate: metadata.modificationDate || null,
    cryptographicSignatureStatus: metadata.cryptographicSignatureStatus || null,
  };
  const sourceProvenance = {
    kind: provenance.kind || "derived",
    derived: true,
    tool: provenance.tool || null,
    sourceDocumentId: sourceContext.documentId || null,
    nativeMetadataAssessable: false,
    cryptographicSignatureAssessable: false,
    reason,
  };
  const procedencia = {
    procedencia: "ARQUIVO_DERIVADO",
    bloqueio: true,
    indicios: [provenance.kind || "fatiamento declarado"],
    mensagem: reason,
  };
  return {
    ...metadata,
    producer: null,
    creator: null,
    creationDate: null,
    modificationDate: null,
    hasAcroForm: null,
    hasEmbeddedSignatures: null,
    cryptographicSignatureStatus: "NÃO AFERÍVEL",
    cryptographicSignatureReason: reason,
    metadataAnalysisStatus: "NOT_ASSESSABLE_DERIVED",
    sourceProvenance,
    derivedFileTechnicalData,
    digitalSignature: {
      procedencia,
      catalog: null,
      estado: "NÃO AFERÍVEL",
      motivo: reason,
      pdfsig: { disponivel: false, assinaturas: [], motivo: reason },
      alerts: [{ codigo: "PJE-DERIVED", severidade: "ATENÇÃO", titulo: "Arquivo derivado", detalhe: reason }],
    },
    warnings: [reason, "Para aferir assinatura digital e metadados, deve ser exibido o arquivo nativo da contratação (arts. 396 e 400 do CPC)."],
  };
}
