/**
 * Classificação dos Achados nos 3 Graus de Conclusão Forense.
 *
 * Cópia de backend/src/engine/grausConclusao.js: manter as duas iguais.
 */

export const GRAUS = {
  CONSTATADO: "CONSTATADO",
  NAO_VERIFICAVEL: "NÃO VERIFICÁVEL",
  INDICIO: "INDÍCIO",
};

export const ROTULOS_GRAU = {
  CONSTATADO: "Constatado",
  NAO_VERIFICAVEL: "Não Verificável",
  INDICIO: "Indício",
};

export const DESCRICAO_GRAU = {
  CONSTATADO: "Demonstrado no arquivo examinado; reproduzível por qualquer perito. Sustenta alegação de montagem e nulidade material.",
  NAO_VERIFICAVEL: "Obrigação probatória não suprida pela instituição financeira. Sustenta o descumprimento do ônus da prova (CPC, art. 429, II e STJ Tema 1.061).",
  INDICIO: "Sinal compatível com fraude documental; não conclui isoladamente e requer convergência com outros elementos do laudo.",
};

/** Achados de autorização INSS que o próprio dossiê demonstra (ver regimeInss.js). */
const INS_CONSTATADOS = new Set(["INS1", "INS4", "INS6", "INS9", "INS10"]);

export function classificarGrauProcessual(codigo, gravidade = "") {
  const c = String(codigo || "").toUpperCase();
  // Autorização do consignado INSS: o que o dossiê mostra é constatado; o que o
  // INSS ou a instituição não apresentou é não verificável.
  if (/^INS\d+$/.test(c)) return INS_CONSTATADOS.has(c) ? GRAUS.CONSTATADO : GRAUS.NAO_VERIFICAVEL;

  if (/^(ASS1|S5|CET2|FIN1|FIN2|LIB2|LIB3|TRL1|TRL4|TRL5|TZ1|TML1|TIME1|PAG1|CRONO\d|IMG_REPEATED|IMG2|IMG3|IMG6|INT3|INT4|CAD4|CAD5|SIGBANK1|IP-INFRAESTRUTURA|HASH-MISMATCH|HASH-MALFORMED|INTEGRITY-REJECTED|DATES-COLLAPSED|CHRONOLOGY|GPS-IP-CONFLICT|GPS-HOME-DISTANCE|GPS-OUTRO-MUNICIPIO|GPS-LOCAL-DECLARADO|DIVERGENCIA-ENDERECO-CADASTRAL|CLIENT-QUALIFICATION)$|^(ASS1|S5|CET2|FIN1|FIN2|LIB2|TRL1|TZ1|TML1|PAG1|CRONO\d|IMG_REPEATED|IMG2|IMG3)/.test(c)) {
    return GRAUS.CONSTATADO;
  }
  if (c.startsWith("GEO") || c === "DISTANCIA" || c === "GPS-IP" || c === "HAW1") {
    return GRAUS.CONSTATADO;
  }

  if (/^(INT1|BIO1|BIO2|AUT1|AUTH1|LIB1|LOG1|IP1|DEV1|DEV3|SEG1|SEG9|CUS1|DOC1|TRL3|IMG0|IMG1|IMG5|OCR1|CEP1|CCB1|RMC1|HASH-MISSING|SIMPLE-SIGNATURE|SIGNATURE-ABSENT|DEVICE-GAP|ECONOMICS-MISSING|METADATA-MISSING)$|^(INT1|BIO2|AUT1|LIB1|LOG1|IP1|DEV1|SEG1|CUS1|DOC1)/.test(c)) {
    return GRAUS.NAO_VERIFICAVEL;
  }

  if (/^(DEV2|TRL2|FAT1|FLOW1|OBS1|TAR1|IDA1|LOJA1|IMG4|METADATA-AUTHOR|METADATA-TEMPLATE)$|^(ELA2|ADE1|CAD\d|EMP\d|SEG2|SEG3|SEG4|INT2|META\d|FIN3|AUT\d)/.test(c)) {
    return GRAUS.INDICIO;
  }

  const g = String(gravidade || "").toUpperCase();
  if (g === "CRÍTICO" || g === "CRITICO") return GRAUS.CONSTATADO;
  if (g === "ALTA" || g === "ALTO") return GRAUS.NAO_VERIFICAVEL;
  return GRAUS.INDICIO;
}

export function contarPorGrau(findings = []) {
  let constatados = 0;
  let naoVerificaveis = 0;
  let indicios = 0;

  for (const f of findings) {
    const grau = f.grau || classificarGrauProcessual(f.key || f.codigo, f.severity || f.gravidade);
    if (grau === GRAUS.CONSTATADO) constatados++;
    else if (grau === GRAUS.NAO_VERIFICAVEL) naoVerificaveis++;
    else if (grau === GRAUS.INDICIO) indicios++;
  }

  return {
    total: findings.length,
    constatados,
    naoVerificaveis,
    indicios,
  };
}
