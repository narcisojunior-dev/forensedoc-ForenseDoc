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

export function classificarGrauProcessual(codigo, gravidade = "") {
  const c = String(codigo || "").toUpperCase();

  if (/^(ASS1|S5|CET2|FIN1|FIN2|LIB2|TRL1|TZ1|TML1|PAG1|CRONO\d|IMG_REPEATED|IMG2|IMG3)/.test(c)) {
    return GRAUS.CONSTATADO;
  }
  if (c.startsWith("GEO") || c === "DISTANCIA" || c === "GPS-IP" || c === "HAW1") {
    return GRAUS.CONSTATADO;
  }

  if (/^(INT1|BIO2|AUT1|LIB1|LOG1|IP1|DEV1|SEG1|CUS1|DOC1)/.test(c)) {
    return GRAUS.NAO_VERIFICAVEL;
  }

  if (/^(ELA2|ADE1|CAD\d|EMP\d|SEG2|SEG3|SEG4|INT2|META\d|FIN3|AUT\d)/.test(c)) {
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
