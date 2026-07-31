import { firstMatch, allMatches, titleCaseName } from "../utils/stringUtils.js";
import { extractIpAddresses } from "../utils/ipExtraction.js";

/*
 * ─── Par de coordenadas solto, validado por PLAUSIBILIDADE ───────────────────
 *
 * O padrão anterior exigia 4 ou mais casas decimais nos DOIS números, como forma
 * de não confundir coordenada com qualquer par de números do documento. O preço
 * apareceu num contrato real: o log de assinatura registrava
 *
 *   -7.115, -34.86306
 *
 * quatro vezes, e a latitude tem TRÊS casas. Nenhuma foi extraída, e o laudo saiu
 * afirmando "não foi localizada geolocalização declarada no log de assinatura
 * deste documento".
 *
 * Esse é o pior tipo de erro possível neste sistema: não é campo em branco, é
 * afirmação de AUSÊNCIA de um dado que está no documento. Ela também rebaixou a
 * cadeia de custódia (o elemento "geolocalização do ato" contou como faltante) e
 * suprimiu o Confronto 2 inteiro, que teria mostrado o local declarado a
 * centenas de quilômetros da referência.
 *
 * A precisão decimal era o critério errado. Contar casas mede formatação, não
 * plausibilidade: coordenada com 3 casas é comum, e um par de valores monetários
 * com 4 casas continuaria passando.
 *
 * O critério certo é geográfico. As faixas abaixo cobrem o território brasileiro
 * com folga, e é praticamente impossível que um par arbitrário de números do
 * documento caia nas duas ao mesmo tempo, com sinal negativo na longitude.
 */
const LAT_BR = [-34, 6];
const LON_BR = [-74, -33];

function numeroDeCoordenada(bruto) {
  return Number(String(bruto).replace(",", "."));
}

function parCoordenadaBrasileira(flat) {
  const candidatos = flat.matchAll(
    /(-?\d{1,2}[,.]\d{3,})\s*[,; ]\s*(-?\d{1,3}[,.]\d{3,})/g
  );
  for (const m of candidatos) {
    const lat = numeroDeCoordenada(m[1]);
    const lon = numeroDeCoordenada(m[2]);
    if (
      Number.isFinite(lat) && lat >= LAT_BR[0] && lat <= LAT_BR[1] &&
      Number.isFinite(lon) && lon >= LON_BR[0] && lon <= LON_BR[1]
    ) {
      return m;
    }
  }
  return null;
}

/*
 * ─── Nome do contratante ─────────────────────────────────────────────────────
 *
 * O padrão anterior usava a flag `/i` junto de uma classe de caixa alta
 * (`[A-ZÁÀÂÃ...]`), o que anula a classe: com `/i`, ela passa a aceitar
 * minúsculas. O efeito foi capturar o próprio rótulo do formulário.
 *
 * Num contrato real, o cabeçalho de tabela "Nome do cliente CPF ID da sessão"
 * fez o motor retroceder, tratar "do cliente" como o VALOR e "CPF" como o
 * delimitador seguinte. O laudo saiu com o contratante chamado "Do Cliente",
 * enquanto o nome verdadeiro aparecia três linhas adiante.
 *
 * Num documento pericial isso é pior que campo vazio: um nome errado no
 * cabeçalho compromete a peça inteira aos olhos de quem lê.
 *
 * A correção separa as duas coisas que a regex misturava. O RÓTULO é procurado
 * sem distinção de caixa, porque documentos escrevem "Nome", "NOME" e "nome". O
 * VALOR é validado à parte, exigindo caixa alta de verdade e recusando palavras
 * que só aparecem em rótulo.
 */
const ROTULOS_NOME = /\b(?:nome\s+do\s+cliente|nome\s+completo|nome\s+do\s+contratante|nome|contratante|benefici[aá]rio)\b/gi;

/** Delimitador que fecha o valor: o campo seguinte do formulário. */
const FIM_DO_NOME = /^\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{7,79}?)(?=\s+(?:CPF|RG|CELULAR|BANCO|AG[ÊE]NCIA|DATA|FILIA|MATR[ÍI]CULA|BENEF[ÍI]CIO)\b)/;

/**
 * Rótulos de PARENTESCO, que trazem nome de outra pessoa.
 *
 * "Nome da mãe LUCIA FRANCA ABREU" está no mesmo contrato, e capturá-lo poria a
 * mãe do contratante como parte do negócio.
 */
const ROTULO_DE_TERCEIRO = /\b(?:m[ãa]e|pai|c[ôo]njuge|representante|testemunha|procurador|fantasia)\b/i;

/** Palavras que aparecem em rótulo e nunca são nome de pessoa. */
const NAO_E_NOME = /^(?:do|da|de|dos|das)\s|^(?:cliente|completo|contratante|titular|benefici[aá]rio|social)\b/i;

function extrairNomeContratante(flat) {
  for (const m of flat.matchAll(ROTULOS_NOME)) {
    // "Nome da mãe" e afins: o valor pertence a outra pessoa.
    const depoisDoRotulo = flat.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (ROTULO_DE_TERCEIRO.test(depoisDoRotulo)) continue;

    const candidato = flat.slice(m.index + m[0].length, m.index + m[0].length + 120).match(FIM_DO_NOME);
    if (!candidato) continue;

    const valor = candidato[1].trim().replace(/\s+/g, " ");
    if (NAO_E_NOME.test(valor)) continue;
    // Nome de pessoa tem ao menos duas partes; uma palavra só costuma ser rótulo.
    if (valor.split(" ").length < 2) continue;

    return valor;
  }
  return null;
}

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
    /RMC|RESERVA DE MARGEM|CART[AÃ]O CONSIGNADO/i.test(flat) ? "Cartão consignado" :
    /RCC|CART[AÃ]O.*BENEF[IÍ]CIO/i.test(flat) ? "RCC" :
    /FGTS/i.test(flat) ? "FGTS" :
    /EMPR[ÉE]STIMO|CONSIGNADO/i.test(flat) ? "Empréstimo consignado" :
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
  // Extração dedicada (utils/ipExtraction.js): cobre IPv6, lê o rótulo do
  // assinador e descarta número de versão de User-Agent, que o regex anterior
  // aceitava como endereço.
  const ipRecords = extractIpAddresses(text);
  const hash = firstMatch(flat, [
    /\b([a-f0-9]{64})\b/i,
    /\b([a-f0-9]{40})\b/i,
    /\b([a-f0-9]{32})\b/i,
    /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i,
  ]);
  const coordPair = parCoordenadaBrasileira(flat);
  /*
   * O rótulo COMBINADO tem precedência sobre os isolados.
   *
   * Assinadores brasileiros escrevem "Latitude e Longitude: -3.4340189 /
   * -60.4593232" — um rótulo, dois valores. Os padrões isolados liam isso
   * errado: `/longitude\s*:?\s*(...)/ ` casava o "Longitude:" de dentro do
   * rótulo combinado e capturava o PRIMEIRO número, que é a latitude. O laudo
   * saía com latitude nula e a latitude ocupando o campo da longitude — uma
   * coordenada trocada num documento pericial.
   */
  const parCombinado = flat.match(
    /latitude\s*(?:e|,|\/)\s*longitude\s*[:\-]?\s*(-?\d{1,2}[,.]\d{3,})\s*[\/,;]\s*(-?\d{1,3}[,.]\d{3,})/i
  );
  const latitudeValue = parCombinado
    ? parCombinado[1]
    : firstMatch(flat, [
        /latitude\s*[:\-]\s*(-?\d{1,2}[,.]\d{3,})/i,
        /\blat\s*[:\-]\s*(-?\d{1,2}[,.]\d{3,})/i,
      ]) || (coordPair ? coordPair[1] : null);
  const longitudeValue = parCombinado
    ? parCombinado[2]
    : firstMatch(flat, [
        /longitude\s*[:\-]\s*(-?\d{1,3}[,.]\d{3,})/i,
        /\blon(?:g)?\s*[:\-]\s*(-?\d{1,3}[,.]\d{3,})/i,
      ]) || (coordPair ? coordPair[2] : null);

  /*
   * O endereço declarado só é aceito se PARECER um endereço.
   *
   * O padrão anterior capturava os 120 caracteres seguintes a qualquer
   * "geolocalização"/"localização" — e num dossiê que traz política de
   * privacidade isso trouxe "cookies, pixel tags, beacons, local shared
   * objects...". O laudo apresentava um trecho de política de privacidade como
   * endereço da assinatura.
   */
  const TERMOS_DE_ENDERECO = /\b(?:rua|avenida|av\.|travessa|rodovia|estrada|alameda|pra[çc]a|bairro|munic[íi]pio|cidade|CEP|n[ºo°]|\d{5}-?\d{3})\b/i;
  const candidatoGeoEndereco = firstMatch(flat, [
    /geolocaliza[cç][aã]o\s*[:\-]?\s*([^.;\n]{8,120})/i,
    /localiza[cç][aã]o\s*[:\-]?\s*([^.;\n]{8,120})/i,
    /(?:local|endere[cç]o)\s+da\s+assinatura\s*[:\-]?\s*([^.;\n]{8,120})/i,
  ]);
  const declaredGeoAddress =
    candidatoGeoEndereco && TERMOS_DE_ENDERECO.test(candidatoGeoEndereco)
      ? candidatoGeoEndereco
      : null;
  const hasSignature = /assinad|assinatura|signat[aá]rio|biometr|token|selfie|certificado|ip\b/i.test(flat);
  const hasAudit = /auditoria|log|trilha|evid[eê]ncia|carimbo|data\s+e\s+hora/i.test(flat);
  const hasGeo = Boolean((latitudeValue && longitudeValue) || declaredGeoAddress);
  const name = titleCaseName(extrairNomeContratante(flat));
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
  if (!ipRecords.length) irregularidades.push("Ausência de endereço IP extraível no texto do documento.");
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
      registro_ip: ipRecords.length > 0,
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
    ips: ipRecords.map((r) => ({
      endereco: r.endereco,
      versao: r.versao,
      porta: r.porta,
      rotulo: r.rotulo,
      contexto: r.contexto,
      data_hora: r.data_hora,
      user_agent: r.user_agent,
    })),
    evidencias_irregularidade: irregularidades,
    observacoes_periciais: lowText
      ? "Laudo gerado em modo local, mas o PDF contém pouco texto pesquisável. Para resultado completo em documentos escaneados, aplique OCR prévio e envie novamente."
      : "Laudo gerado por extração textual local do PDF. A estrutura do relatório foi preservada, mas recomenda-se validação humana dos campos extraídos.",
  };
}
