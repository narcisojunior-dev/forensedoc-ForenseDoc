import { firstMatch, allMatches, titleCaseName } from "../utils/stringUtils.js";

export function heuristicExtractionFromText(rawText) {
  const text = String(rawText || "").replace(/\r/g, "\n");
  const flat = text.replace(/\s+/g, " ").trim();
  const upper = flat.toUpperCase();
  const lowText = flat.length < 400;

  const cpf = firstMatch(flat, [
    /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/,
    /CPF[:\s]*([0-9.\-]{11,14})/i,
  ]);
  const cep = firstMatch(flat, [/\b(\d{5}-?\d{3})\b/]);
  const contratoNumero = firstMatch(flat, [
    /(?:contrato|proposta|c[eé]dula|opera[cç][aã]o)\s*(?:n[ºo.]*)?\s*[:\-]?\s*([A-Z0-9.\-\/]{5,})/i,
    /\b(?:CCB|ADE)\s*[:\-]?\s*([A-Z0-9.\-\/]{5,})/i,
  ]);
  const banco = firstMatch(upper, [
    /\b(BANCO\s+BMG|BMG)\b/,
    /\b(BANCO\s+BRADESCO|BRADESCO)\b/,
    /\b(BANCO\s+PAN|PAN)\b/,
    /\b(C6\s+BANK|BANCO\s+C6)\b/,
    /\b(BANCO\s+DAYCOVAL|DAYCOVAL)\b/,
    /\b(BANCO\s+SAFRA|SAFRA)\b/,
    /\b(BANCO\s+ITAU|ITA[UÚ])\b/,
    /\b(BANCO\s+OLE|OL[ÉE]\s+CONSIGNADO)\b/,
    /\b(PARAN[ÁA]\s*BANCO|PARANABANCO)\b/,
  ]);
  const modalidade =
    /RMC|RESERVA DE MARGEM|CART[AÃ]O CONSIGNADO/i.test(flat) ? "Cartao Consignado" :
    /RCC|CART[AÃ]O.*BENEF[IÍ]CIO/i.test(flat) ? "RCC" :
    /FGTS/i.test(flat) ? "FGTS" :
    /EMPR[ÉE]STIMO|CONSIGNADO/i.test(flat) ? "Emprestimo Pessoal" :
    null;
  const valorContratado = firstMatch(flat, [
    /(?:valor\s+(?:contratado|liberado|financiado|do\s+cr[eé]dito)|cr[eé]dito)\s*[:\-]?\s*(R\$\s*[\d.]+,\d{2})/i,
    /\b(R\$\s*[\d.]+,\d{2})\b/,
  ]);
  const valorParcela = firstMatch(flat, [
    /(?:valor\s+da\s+parcela|parcela)\s*[:\-]?\s*(R\$\s*[\d.]+,\d{2})/i,
    /valor\s+parcela\s+de\s+origem\s*[:\-]?\s*(R\$?\s*[\d.]+,\d{2})/i,
    /(?:presta[cç][aã]o)\s*[:\-]?\s*(R\$\s*[\d.]+,\d{2})/i,
  ]);
  const numeroParcelas = firstMatch(flat, [
    /(?:n[úu]mero\s+de\s+parcelas|parcelas|prazo)\s*[:\-]?\s*(\d{2,3})/i,
    /(\d{2,3})\s*(?:parcelas|presta[cç][oõ]es)/i,
  ]);
  const taxaMensal = firstMatch(flat, [/(?:juros\s+mensal|taxa\s+mensal)\s*[:\-]?\s*([\d,.]+\s*%)/i]);
  const taxaAnual = firstMatch(flat, [/(?:juros\s+anual|taxa\s+anual)\s*[:\-]?\s*([\d,.]+\s*%)/i]);
  const cetMensal = firstMatch(flat, [/(?:CET\s+mensal|C\.?E\.?T\.?\s*a\.?m\.?)\s*[:\-]?\s*([\d,.]+\s*%)/i]);
  const cetAnual = firstMatch(flat, [/(?:CET\s+anual|C\.?E\.?T\.?\s*a\.?a\.?)\s*[:\-]?\s*([\d,.]+\s*%)/i]);
  const dates = allMatches(flat, /\b(\d{2}\/\d{2}\/\d{4})\b/g);
  const ipValues = Array.from(new Set(allMatches(flat, /\b((?:\d{1,3}\.){3}\d{1,3})\b/g)))
    .filter((ip) => ip.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255));
  const hash = firstMatch(flat, [
    /\b([a-f0-9]{64})\b/i,
    /\b([a-f0-9]{40})\b/i,
    /\b([a-f0-9]{32})\b/i,
    /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i,
  ]);
  const coordPair = flat.match(/(-?\d{1,2}[,.]\d{4,})\s*[,; ]\s*(-?\d{1,3}[,.]\d{4,})/);
  const latitudeValue = firstMatch(flat, [
    /latitude\s*:?\s*(-?\d{1,2}[,.]\d{3,})/i,
    /lat\s*:?\s*(-?\d{1,2}[,.]\d{3,})/i,
  ]) || (coordPair ? coordPair[1] : null);
  const longitudeValue = firstMatch(flat, [
    /longitude\s*:?\s*(-?\d{1,3}[,.]\d{3,})/i,
    /lon(?:g)?\s*:?\s*(-?\d{1,3}[,.]\d{3,})/i,
  ]) || (coordPair ? coordPair[2] : null);
  const declaredGeoAddress = firstMatch(flat, [
    /geolocaliza[cç][aã]o\s*[:\-]?\s*([^.;\n]{8,120})/i,
    /localiza[cç][aã]o\s*[:\-]?\s*([^.;\n]{8,120})/i,
  ]);
  const hasSignature = /assinad|assinatura|signat[aá]rio|biometr|token|selfie|certificado|ip\b/i.test(flat);
  const hasAudit = /auditoria|log|trilha|evid[eê]ncia|carimbo|data\s+e\s+hora/i.test(flat);
  const hasGeo = Boolean((latitudeValue && longitudeValue) || declaredGeoAddress);
  const name = titleCaseName(firstMatch(flat, [
    /(?:nome\s*(?:do\s+cliente|completo)?|contratante|benefici[aá]rio)\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)(?=\s+(?:CPF|RG|CELULAR|BANCO|AG[ÊE]NCIA)\b)/i,
    /NOME\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80})\s+(?:CPF|RG|DATA|FILIA)/i,
  ]));
  const endereco = firstMatch(flat, [
    /endere[cç]o\s*[:\-]?\s*([^.;\n]{8,100}?)(?=\s+(?:n[uú]mero\s+do\s+endere[cç]o|numero\s+do\s+endere[cç]o|complemento|cep|promotor)\b)/i,
    /((?:rua|avenida|av\.|travessa|tv\.|rodovia|estrada)\s+[^.]{8,120})/i,
    /endere[cç]o\s*[:\-]?\s*([^.;\n]{8,140})/i,
  ]);
  const cidade = firstMatch(flat, [
    /cidade\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:bairro|endere[cç]o|cep|estado)\b)/i,
    /cidade\s*[:\-]?\s*([^,.;\n]{3,60})/i,
  ]);
  const bairro = firstMatch(flat, [
    /bairro\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:endere[cç]o|cep|cidade|estado)\b)/i,
    /bairro\s*[:\-]?\s*([^,.;\n]{3,60})/i,
  ]);

  const irregularidades = [];
  if (lowText) irregularidades.push("O PDF possui pouco texto pesquisável/OCR extraível. Para resultado completo em documento escaneado, aplique OCR prévio ao arquivo.");
  if (!hash) irregularidades.push("Ausência de hash de integridade extraível no texto do documento.");
  if (!ipValues.length) irregularidades.push("Ausência de endereço IP extraível no texto do documento.");
  if (!hasGeo) irregularidades.push("Ausência de geolocalização GPS extraível no texto do documento.");
  if (!hasAudit) irregularidades.push("Trilha de auditoria não identificada pela extração local.");

  return {
    tipo_documento: /contrato|c[eé]dula|proposta|termo/i.test(flat) ? "Contrato bancário / proposta de crédito" : "Documento PDF",
    qualidade_ocr: flat.length > 2500 ? "Alta" : flat.length > 600 ? "Media" : "Baixa",
    contrato: {
      numero: contratoNumero,
      banco,
      produto: modalidade ? "Crédito consignado" : null,
      modalidade,
      valor_contratado: valorContratado,
      valor_parcela: valorParcela,
      numero_parcelas: numeroParcelas,
      prazo_meses: numeroParcelas,
      taxa_juros_mensal: taxaMensal,
      taxa_juros_anual: taxaAnual,
      cet_mensal: cetMensal,
      cet_anual: cetAnual,
      data_contrato: dates[0] || null,
      data_primeiro_vencimento: dates[1] || null,
      data_ultimo_vencimento: dates[2] || null,
      codigo_banco_bacen: null,
    },
    cliente: {
      nome: name,
      cpf,
      rg: firstMatch(flat, [/RG\s*[:\-]?\s*([0-9.\-]{5,20})/i]),
      data_nascimento: firstMatch(flat, [/(?:nascimento|data\s+nasc\.?)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i]),
      endereco,
      bairro,
      cidade,
      estado: firstMatch(flat, [/estado\s*[:\-]?\s*([A-Z]{2})\b/i, /\b([A-Z]{2})\b(?=\s*(?:CEP|cep|\d{5}-?\d{3}))/]),
      cep,
      telefone: firstMatch(flat, [/\b(\(?\d{2}\)?\s*9?\d{4}-?\d{4})\b/]),
      email: firstMatch(flat, [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i]),
      matricula_inss: firstMatch(flat, [/(?:matr[ií]cula)\s*[:\-]?\s*([0-9.\-\/]{5,30})/i]),
      numero_beneficio: firstMatch(flat, [/(?:benef[ií]cio|NB)\s*[:\-]?\s*([0-9.\-\/]{5,30})/i]),
      especie_beneficio: firstMatch(flat, [/(?:esp[eé]cie)\s*[:\-]?\s*([^,.;\n]{2,50})/i]),
      banco_recepcao: null,
    },
    assinatura: {
      presente: hasSignature,
      plataforma: firstMatch(flat, [/(?:plataforma|provedor)\s*[:\-]?\s*([^,.;\n]{3,60})/i]),
      tipo: hasSignature ? "Indeterminado" : "Ausente",
      nivel_legal_mp2200: hasSignature ? "Indeterminado" : "Ausente",
      base_legal: null,
      certificadora_ac: firstMatch(flat, [/(?:AC|Autoridade Certificadora)\s*[:\-]?\s*([^,.;\n]{3,80})/i]),
      titular_certificado: name,
      cpf_titular: cpf,
      data_hora_assinatura: firstMatch(flat, [/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/]),
      validade_certificado_inicio: null,
      validade_certificado_fim: null,
      metodos_autenticacao: [
        /token|sms/i.test(flat) ? "SMS Token" : null,
        /biometr/i.test(flat) ? "Biometria" : null,
        /selfie/i.test(flat) ? "Selfie" : null,
        /email|e-mail/i.test(flat) ? "E-mail" : null,
      ].filter(Boolean),
      hash_documento_assinado: hash,
      algoritmo_hash: hash?.length === 64 ? "SHA-256" : hash?.length === 40 ? "SHA-1" : hash?.length === 32 ? "MD5" : null,
      numero_serie_certificado: firstMatch(flat, [/(?:s[eé]rie\s+do\s+certificado|serial)\s*[:\-]?\s*([A-Z0-9.\-]{4,80})/i]),
      integridade_pos_assinatura: null,
      observacoes: lowText
        ? "Extração local encontrou pouco texto pesquisável. O documento aparenta depender de OCR/visão computacional para leitura completa."
        : "Extração local por texto do PDF. Revise manualmente os campos antes de uso em peça processual.",
    },
    geolocalizacao_assinatura: {
      presente: hasGeo,
      latitude: latitudeValue ? latitudeValue.replace(",", ".") : null,
      longitude: longitudeValue ? longitudeValue.replace(",", ".") : null,
      endereco_declarado: declaredGeoAddress,
      precisao_metros: firstMatch(flat, [/precis[aã]o\s*[:\-]?\s*([\d,.]+)\s*m/i]),
      fonte: hasGeo ? "Texto extraído do PDF" : null,
      data_hora: firstMatch(flat, [/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/]),
    },
    cadeia_custodia: {
      identificacao_signatario: Boolean(name || cpf),
      registro_ip: ipValues.length > 0,
      carimbo_tempo: /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(flat),
      geolocalizacao: hasGeo,
      metodo_autenticacao: /token|sms|biometr|selfie|email|e-mail|senha/i.test(flat),
      hash_integridade: Boolean(hash),
      trilha_auditoria: hasAudit,
      evidencia_aceite: /aceite|aceito|concordo|autoriza|autorizo/i.test(flat),
      observacoes: lowText
        ? "Cadeia de custódia não pôde ser inferida com segurança porque o PDF possui pouco texto extraível."
        : "Cadeia de custódia inferida por extração local. Revise os campos antes de uso em peça processual.",
    },
    ips: ipValues.map((ip) => ({ endereco: ip, contexto: "IP extraído do texto do PDF", data_hora: null, user_agent: null })),
    evidencias_irregularidade: irregularidades,
    observacoes_periciais: lowText
      ? "Laudo gerado em modo local, mas o PDF contém pouco texto pesquisável. Para resultado completo em documentos escaneados, aplique OCR prévio e envie novamente."
      : "Laudo gerado por extração textual local do PDF. A estrutura do relatório foi preservada, mas recomenda-se validação humana dos campos extraídos.",
  };
}
