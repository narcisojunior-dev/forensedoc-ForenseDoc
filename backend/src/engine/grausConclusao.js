/**
 * Classificação dos Achados nos 3 Graus de Conclusão Forense.
 *
 * ─── Roteiro Técnico e Processual ───────────────────────────────────────────
 *
 * Conforme estabelecido no manual de regras periciais (Seção 10 e Figura 3):
 *
 * 1. CONSTATADO:
 *    O fato está materialmente gravado no arquivo e qualquer perito reproduz
 *    o teste: hash repetido, ModDate posterior à assinatura, ausência de PAdES/AcroForm,
 *    IP ou GPS em município discrepante da residência do contratante, CET divergente.
 *    -> Efeito processual: Sustenta a afirmação de MONTAGEM ou NULIDADE MATERIAL.
 *
 * 2. NÃO VERIFICÁVEL:
 *    O material exigido pela regulamentação técnica e bancária (CMN 4.893/2021,
 *    INSS 138/2022) não foi apresentado pelo credor: sem IP, sem log bruto do servidor,
 *    sem hash declarado pelo emissor, sem teste de vivacidade, sem fornecedor de biometria,
 *    sem segundo fator (SMS/token) comprovado, sem comprovante bancário de liberação.
 *    -> Efeito processual: Sustenta o DESCUMPRIMENTO DO ÔNUS DA PROVA (CPC art. 429, II e Tema 1.061/STJ).
 *
 * 3. INDÍCIO:
 *    Compatível com fraude, mas admite explicação em tese: selfie sem EXIF, motor
 *    HTML dompdf, cadastro com e-mail institucional/padrão, campos em branco,
 *    anomalia ELA2 isolada, cláusula de adesão abusiva.
 *    -> Efeito processual: Contextualiza o golpe; SÓ FECHA CONVICÇÃO QUANDO SOMADO A OUTROS.
 */

export const GRAUS = {
  CONSTATADO: "CONSTATADO",
  NAO_VERIFICAVEL: "NÃO VERIFICÁVEL",
  INDICIO: "INDÍCIO",
};
export const GRAUS_PROCESSO_CIVIL = GRAUS;

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

/**
 * Classifica um achado pericial em um dos 3 graus de conclusão processual.
 *
 * @param {string} codigo - Código identificador do achado (ex: "ASS1", "BIO2", "AUT1", "ELA2")
 * @param {string} [gravidade=""] - Severidade do achado ("CRÍTICA", "ALTA", "MÉDIA", "INFO")
 * @returns {"CONSTATADO" | "NÃO VERIFICÁVEL" | "INDÍCIO"} Grau de conclusão
 */
export function classificarGrauProcessual(codigo, gravidade = "") {
  const c = String(codigo || "").toUpperCase();

  // 1. CONSTATADO: reproduzível no documento / cálculo objetivo direto
  if (/^(ASS1|S5|CET2|FIN1|FIN2|LIB2|TRL1|TZ1|TML1|PAG1|CRONO\d|IMG_REPEATED|IMG2|IMG3)/.test(c)) {
    return GRAUS.CONSTATADO;
  }
  if (c.startsWith("GEO") || c === "DISTANCIA" || c === "GPS-IP" || c === "HAW1") {
    return GRAUS.CONSTATADO;
  }

  // 2. NÃO VERIFICÁVEL: material/dever que o banco sonegou ou não apresentou
  if (/^(INT1|BIO2|AUT1|LIB1|LOG1|IP1|DEV1|SEG1|CUS1|DOC1)/.test(c)) {
    return GRAUS.NAO_VERIFICAVEL;
  }

  // 3. INDÍCIO: indício técnico que necessita de corroboração
  if (/^(ELA2|ADE1|CAD\d|EMP\d|SEG2|SEG3|SEG4|INT2|META\d|FIN3|AUT\d)/.test(c)) {
    return GRAUS.INDICIO;
  }

  // Fallback baseado na gravidade declarada
  const g = String(gravidade || "").toUpperCase();
  if (g === "CRÍTICO" || g === "CRITICO") return GRAUS.CONSTATADO;
  if (g === "ALTA" || g === "ALTO") return GRAUS.NAO_VERIFICAVEL;
  return GRAUS.INDICIO;
}

/**
 * Totaliza a contagem dos achados pelos 3 graus processuais.
 *
 * @param {Array<object>} findings - Lista de achados com código ou grau
 * @returns {{ total: number, constatados: number, naoVerificaveis: number, indicios: number }}
 */
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
