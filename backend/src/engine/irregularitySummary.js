import { buildCustodyChain } from "../reports/custodyChain.js";
import { ordenarAchados } from "./eixosAchado.js";
import { classificarGrauProcessual, contarPorGrau } from "./grausConclusao.js";
import { citarDispositivo, DISPOSITIVOS_IN138, REGIMES_COM_IN138 } from "./regimeInss.js";
import { distanciaKm, distanciaSuspeita, formatarDistancia, montarConfrontoGeografico, STATUS_CONFRONTO } from "../utils/distancia.js";
import { descreverIndisponibilidade } from "../utils/confrontoEnderecos.js";
// Sumário executivo de irregularidades (placar de gravidade, confronto GPS x IP,
// triagem de IPs e diligências). Portado do motor de geração, onde era calculado
// no navegador; no SaaS é calculado no servidor e persistido com o laudo.
const EMPTY_VALUES = new Set([
  "",
  "ausente",
  "indeterminado",
  "nao identificado",
  "nao informada",
  "nao informado",
  "nao se aplica",
  "n/a",
  "null",
  "undefined",
]);

const BANK_STOP_WORDS = new Set([
  "banco", "instituicao", "financeira", "credito", "s.a", "sa", "do", "da", "de",
]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasValue);
  return !EMPTY_VALUES.has(normalizeText(value));
}

function compact(value, limit = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function formatCpf(value) {
  const onlyDigits = digits(value);
  if (onlyDigits.length !== 11) return value;
  return `${onlyDigits.slice(0, 3)}.${onlyDigits.slice(3, 6)}.${onlyDigits.slice(6, 9)}-${onlyDigits.slice(9)}`;
}

function hashKind(value) {
  const hash = String(value ?? "").replace(/\s/g, "");
  if (/^[a-f0-9]{64}$/i.test(hash)) return "SHA-256";
  if (/^[a-f0-9]{40}$/i.test(hash)) return "SHA-1";
  if (/^[a-f0-9]{32}$/i.test(hash)) return "MD5";
  return hash ? "INVALIDO" : null;
}

function shortHash(value) {
  const hash = String(value ?? "").replace(/\s/g, "").toUpperCase();
  if (!hash) return "não informado";
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
}

function dateIdentity(value) {
  const match = String(value ?? "").match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const year = match[3];
  if (a > 12 && b <= 12) return `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
  if (b > 12 && a <= 12) return `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  return `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
}

// Nulo é ausência: devolve null, e quem chama suprime o trecho (ver utils/distancia.js).
const formatKm = formatarDistancia;

function locationLabel(geo) {
  const city = hasValue(geo?.city) ? geo.city : null;
  const region = hasValue(geo?.region) ? geo.region : null;
  const country = hasValue(geo?.country) ? geo.country : null;
  return [city, region].filter(Boolean).join("/") || country || "localização indisponível";
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [aLat, aLon, bLat, bLon] = values;
  const radius = 6371;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bankTokens(bank) {
  return normalizeText(bank)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !BANK_STOP_WORDS.has(token));
}

export function classifyIpRole(ip, report = {}) {
  const address = String(ip?.endereco ?? "").trim();
  const context = normalizeText(ip?.contexto);
  const isp = normalizeText(ip?.geo?.isp);
  const auditIps = report?.extracted?.trilha_acesso?.uniqueIps || [];
  if (auditIps.map(String).includes(address)) return "access";
  if (/(historico|trilha|assinatura|signatario|acesso|sessao)/.test(context)) return "access";
  if (/(akamai|cloudflare|fastly|cdn|content delivery)/.test(`${isp} ${context}`)) return "cdn";
  const tokens = bankTokens(report?.extracted?.contrato?.banco);
  if (tokens.some((token) => `${isp} ${context}`.includes(token))) return "bank";
  if (/(servidor|infraestrutura|datacenter|data center|hosting|host)/.test(context)) return "infrastructure";
  return "unknown";
}

function buildIpCard(ip, role, bank) {
  const provider = hasValue(ip?.geo?.isp) ? ip.geo.isp : "provedor não identificado";
  const place = locationLabel(ip?.geo);
  const distance = formatKm(ip?.distancia_residencia ?? null);
  const common = `${provider}, ${place}${distance ? `, ${distance} da referência residencial` : ""}.`;
  if (role === "access") {
    return {
      ...ip,
      role,
      badge: "ACESSO PROVÁVEL",
      text: `${common} Associado à trilha de acesso; CGNAT, VPN ou roteamento regional podem reduzir a precisão. Não prova, isoladamente, a presença física do signatário.`,
    };
  }
  if (role === "bank") {
    return {
      ...ip,
      role,
      badge: "SERVIDOR DO BANCO",
      text: `${common} Indício de infraestrutura de ${bank || "instituição financeira"}; não deve ser usado para localizar o consumidor.`,
    };
  }
  if (role === "cdn") {
    return {
      ...ip,
      role,
      badge: "CDN",
      text: `${common} Nó de distribuição de conteúdo ou borda de rede; não representa a conexão física do usuário.`,
    };
  }
  if (role === "infrastructure") {
    return {
      ...ip,
      role,
      badge: "INFRAESTRUTURA",
      text: `${common} O contexto indica infraestrutura técnica; não localiza o consumidor.`,
    };
  }
  return {
    ...ip,
    role,
    badge: "A CLASSIFICAR",
    text: `${common} O laudo não contém contexto suficiente para afirmar se é acesso do usuário ou infraestrutura.`,
  };
}

function chainScore(report) {
  const c = buildCustodyChain(report.extracted || {}, report.ipAnalysis || [], Boolean(report.geoDeclaredPresent || report.contractGeo));
  return { present: c.presentes, total: c.total, missing: c.faltantes.map(e => e.nome) };
}

function evidenceSeverity(text) {
  if (/\bCR[IÍ]TICO\b/i.test(text)) return "ALTA";
  if (/\bALTA\b/i.test(text)) return "ALTA";
  if (/reimpress[aã]o|exporta[cç][aã]o posterior|posterior .*contrata[cç][aã]o/i.test(text)) return "MÉDIA";
  if (/\bM[ÉE]DIO|M[ÉE]DIA\b/i.test(text)) return "MÉDIA";
  if (/\bINFO\b/i.test(text)) return "INFO";
  return "MÉDIA";
}

function normalizeIssue(issue, index = 0) {
  if (issue && typeof issue === "object") {
    const codigo = issue.codigo || `AUTO${index}`;
    const gravidade = issue.gravidade || issue.severidade || "MÉDIA";
    return {
      codigo,
      gravidade,
      grau: issue.grau || classificarGrauProcessual(codigo, gravidade),
      titulo: compact(String(issue.titulo || "Achado técnico").replace(/\.+$/, ""), 120),
      // D5: sem corte aqui. O texto integral é o que o corpo do laudo publica;
      // a compactação é da apresentação resumida, aplicada só no sumário.
      texto: String(issue.texto || issue.detalhe || "").replace(/\s+/g, " ").trim(),
    };
  }
  const clean = String(issue || "")
    .replace(/\b(?:CET1|FIN\d|IMG\d|INT\d|TRB\d|CAD\d|CUS\d|LOG\d)\s+(?:ALTA|MEDIA|MÉDIA|MÉDIO|INFO|CRITICO|CRÍTICO)\s*:\s*/g, "")
    .replace(/\b(?:CET1|FIN\d|IMG\d|INT\d|TRB\d|CAD\d|CUS\d|LOG\d)\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const [title, ...rest] = clean.split(/\. +/);
  const codigo = `LEGADO${index}`;
  const gravidade = evidenceSeverity(clean);
  return {
    codigo,
    gravidade,
    grau: classificarGrauProcessual(codigo, gravidade),
    titulo: (title || "Achado técnico").replace(/\.+$/, ""),
    texto: rest.join(". "),
  };
}

export function buildIrregularitySummary(report = {}) {
  const extracted = report.extracted || {};
  const contract = extracted.contrato || {};
  const client = extracted.cliente || {};
  const signature = extracted.assinatura || {};
  const audit = extracted.trilha_acesso || {};
  const metadata = report.metadata || null;
  const bank = hasValue(contract.banco) ? contract.banco : "Instituição financeira não identificada";
  const contractNumber = hasValue(contract.numero) ? contract.numero : "não identificado";
  const cpf = hasValue(client.cpf) ? formatCpf(client.cpf) : (hasValue(signature.cpf_titular) ? formatCpf(signature.cpf_titular) : "não identificado");
  const checks = [];
  const findings = [];
  const favorable = [];
  const diligences = [];
  const issueKeys = new Set();
  const diligenceKeys = new Set();

  const addCheck = (domain, key, status, detail = "") => checks.push({ domain, key, status, detail });
  // O quinto argumento aceita o grau (string) ou { grau, ancora }: grau e
  // âncora viajam com o achado até o § 6 (ver grausConclusao.js).
  const addFinding = (severity, key, title, text, extra = {}) => {
    const identidade = JSON.stringify([key, title, String(text || "").replace(/\s+/g, " ").trim()]);
    if (issueKeys.has(identidade)) return;
    issueKeys.add(identidade);
    // O texto entra integral. Quem resume é a página do sumário, em
    // `displayFindings`, e o corpo do laudo publica o texto completo.
    const opcoes = typeof extra === "string" ? { grau: extra } : (extra || {});
    const entry = {
      severity,
      key,
      title,
      text: String(text || "").replace(/\s+/g, " ").trim(),
      grau: opcoes.grau || classificarGrauProcessual(key, severity),
    };
    if (opcoes.ancora) entry.ancora = opcoes.ancora;
    if (severity === "FAVORÁVEL") favorable.push(entry); else findings.push(entry);
  };
  const addDiligence = (key, title, text) => {
    if (diligenceKeys.has(key)) return;
    diligenceKeys.add(key);
    diligences.push({ key, title, text: String(text || "").replace(/\s+/g, " ").trim() });
  };

  const declaredHash = String(signature.hash_documento_assinado || "").replace(/\s/g, "");
  const calculatedHash = String(report.hashes?.sha256 || "").replace(/\s/g, "");
  const declaredKind = hashKind(declaredHash);
  const hashMismatch = declaredKind === "SHA-256" && hashKind(calculatedHash) === "SHA-256"
    && declaredHash.toUpperCase() !== calculatedHash.toUpperCase();
  const hashMalformed = declaredKind === "INVALIDO";
  // Hash e código de autenticação têm estados próprios desde a separação dos
  // dois campos; análises antigas guardavam o estado do código no do hash.
  const codigoNaoConferivel = !declaredHash && (
    signature.codigo_autenticacao_estado === "DECLARADO_NAO_CONFERIVEL"
    || signature.hash_declarado_estado === "DECLARADO_NAO_CONFERIVEL"
    || (!signature.codigo_autenticacao_estado && !signature.hash_declarado_estado && hasValue(signature.codigo_autenticacao_declarado))
  );
  const declaredHashState = codigoNaoConferivel ? "DECLARADO_NAO_CONFERIVEL" : signature.hash_declarado_estado || null;
  const hashMissing = !declaredHash && !codigoNaoConferivel;
  const achadoInt1DaExtracao = (extracted.achados_irregularidade || []).find((issue) => issue?.codigo === "INT1");
  const embeddedMissing = metadata?.hasEmbeddedSignatures === false;
  const producerModified = /(modified using|modificado por|itext)/i.test(metadata?.producer || "");

  if (signature.integridade_pos_assinatura === false) {
    addFinding("ALTA", "integrity-rejected", "Integridade pós-assinatura rejeitada.", "O próprio laudo registra falha de integridade após a assinatura. O arquivo original e o payload assinado devem ser preservados e periciados.");
    addCheck("A", "integridade-pos-assinatura", "ALERTA", "Integridade marcada como não preservada.");
  } else if (hashMalformed) {
    addFinding("ALTA", "hash-malformed", "Hash informado não é criptográfico.", `O valor declarado (${shortHash(declaredHash)}) não corresponde a um formato criptográfico reconhecido e não permite conferir objetivamente a integridade.`);
    addCheck("A", "hash", "ALERTA", "Valor informado não corresponde a hash reconhecido.");
  } else if (hashMismatch) {
    addFinding("MÉDIA", "hash-mismatch", "Integridade em aberto.", `O hash declarado (${shortHash(declaredHash)}) diverge do SHA-256 recalculado (${shortHash(calculatedHash)}).${embeddedMissing ? " Não foi detectada assinatura PAdES incorporada." : ""}${producerModified ? ` O produtor (${metadata.producer}) indica pós-processamento do PDF.` : ""} A divergência exige o payload original e a metodologia de cálculo; não comprova adulteração isoladamente.`);
    addCheck("A", "hash", "ALERTA", "Hash declarado diverge do recalculado.");
  } else if (declaredHashState === "DECLARADO_NAO_CONFERIVEL" && achadoInt1DaExtracao) {
    // A extração já redigiu o achado com o fundamento certo (autoverificação,
    // gravidade própria); aqui fica só o registro no quadro de verificação.
    addCheck("A", "hash", "ALERTA", "Sem hash declarado; apenas código de autenticação conferível no próprio emissor.");
  } else if (declaredHashState === "DECLARADO_NAO_CONFERIVEL") {
    addFinding("MÉDIA", "INT1", "Código de autenticação declarado e inverificável.", "Há código de autenticação declarado no documento, porém sem algoritmo, payload de referência e procedimento público de conferência. Caracteres fora dos alfabetos usuais podem decorrer de fonte embutida sem mapa ToUnicode; por isso, o bloco deve ser confrontado com a renderização visual antes de conclusão sobre seu alfabeto.");
    addCheck("A", "hash", "ALERTA", "Código declarado, mas inverificável.");
  } else if (hashMissing) {
    addFinding("MÉDIA", "hash-missing", "Integridade não confrontável pelo documento.", "O contrato não apresenta hash declarado para comparação com a impressão digital calculada pelo ForenseDoc.");
    addCheck("A", "hash", "ALERTA", "Hash declarado ausente.");
  } else if (declaredKind !== "SHA-256" || hashKind(calculatedHash) !== "SHA-256") {
    addCheck("A", "hash", "INDETERMINADO", `Comparação não realizada: algoritmo declarado ${declaredKind}; é necessário SHA-256 declarado e recalculado válidos.`);
  } else {
    addCheck("A", "hash", "CONFERIDO", "Hash declarado compatível com o arquivo analisado.");
    addFinding("FAVORÁVEL", "hash-ok", "Hash informado confere com o arquivo.", `O SHA-256 declarado coincide com o valor recalculado (${shortHash(calculatedHash)}).`);
  }

  if (metadata) {
    const descriptiveMissing = [metadata.title, metadata.author, metadata.subject, metadata.creator].filter((value) => !hasValue(value)).length;
    if (descriptiveMissing >= 3) {
      addFinding("INFO", "metadata-missing", "Metadados descritivos insuficientes.", `${descriptiveMissing} dos 4 campos principais (título, autor, assunto e aplicativo criador) não foram identificados. Em exportações por motor HTML/PDF, isso é nota de rastreabilidade, não defeito autônomo de média gravidade.`);
      addCheck("B", "metadados-descritivos", "ALERTA", `${descriptiveMissing} campos ausentes.`);
    } else {
      addCheck("B", "metadados-descritivos", "CONFERIDO");
    }
    const authorMismatch = (metadata.warnings || []).find((warning) => /autor declarado.*difere/i.test(warning));
    if (authorMismatch) addFinding("MÉDIA", "metadata-author", "Autoria declarada nos metadados diverge do contratante.", authorMismatch);
    addCheck("B", "estrutura-pdf", embeddedMissing ? "ALERTA" : "CONFERIDO", embeddedMissing ? "Assinatura PAdES não detectada." : "Assinatura incorporada detectada.");
  } else {
    addCheck("B", "metadados", "INDETERMINADO", "Metadados internos indisponíveis.");
  }

  for (const alert of (metadata?.digitalSignature?.alerts || []).slice(0, 6)) {
    addFinding(alert.severidade === "CRÍTICO" ? "ALTA" : "MÉDIA", `sig-${alert.codigo}-${normalizeText(alert.titulo).slice(0, 20)}`, `Assinatura digital: ${alert.titulo}.`, alert.detalhe);
  }

  // Cartão consignado (RMC/RCC) não tem valor contratado, parcela fixa nem
  // número de parcelas — esses conceitos são de empréstimo. Usar os campos
  // equivalentes do cartão evita acusar "instrumento sem números essenciais"
  // quando os dados do cartão estão presentes em contract.cartao.
  const isCartaoConsignado = contract.modalidade === "RMC" || contract.modalidade === "RCC";
  const economicFields = isCartaoConsignado
    ? [
        ["limite do cartão", contract.cartao?.limiteCartao],
        ["valor máximo de saque", contract.cartao?.valorMaximoSaque],
        ["valor consignado mensal", contract.cartao?.valorConsignadoMensal],
        ["taxa mensal", contract.taxa_juros_mensal],
        ["taxa anual", contract.taxa_juros_anual],
        ["CET mensal", contract.cet_mensal],
        ["CET anual", contract.cet_anual],
      ]
    : [
        ["valor contratado", contract.valor_contratado],
        ["valor da parcela", contract.valor_parcela],
        ["número de parcelas", contract.numero_parcelas || contract.prazo_meses],
        ["taxa mensal", contract.taxa_juros_mensal],
        ["taxa anual", contract.taxa_juros_anual],
        ["CET mensal", contract.cet_mensal],
        ["CET anual", contract.cet_anual],
      ];
  const missingEconomics = economicFields.filter(([, value]) => !hasValue(value)).map(([label]) => label);
  if (missingEconomics.length >= 4) {
    addFinding("ALTA", "economics-missing", "Instrumento sem os números essenciais do negócio.", `Não foram identificados ${missingEconomics.join(", ")}. A ausência deve ser confrontada com o instrumento completo e o demonstrativo do CET (CDC, arts. 6º, III, e 52; Res. CMN 4.881/2020).`);
    addCheck("C", "dados-economicos", "ALERTA", `${missingEconomics.length} campos essenciais ausentes.`);
  } else if (missingEconomics.length) {
    addCheck("C", "dados-economicos", "ALERTA", `${missingEconomics.length} campos ausentes.`);
  } else {
    addCheck("C", "dados-economicos", "CONFERIDO");
  }

  const dateValues = [contract.data_contrato, contract.data_primeiro_vencimento, contract.data_ultimo_vencimento].filter(hasValue);
  const dateKeys = dateValues.map(dateIdentity).filter(Boolean);
  if (dateKeys.length >= 2 && new Set(dateKeys).size === 1) {
    addFinding("ALTA", "dates-collapsed", "Datas contratuais sem cronograma coerente.", `Contrato, primeiro vencimento e/ou último vencimento recaem na mesma data (${contract.data_contrato || dateValues[0]}), sem demonstrar uma sequência regular de amortização.`);
    addCheck("C", "datas", "ALERTA", "Datas contratuais colapsadas.");
  } else {
    addCheck("C", "datas", dateKeys.length ? "CONFERIDO" : "INDETERMINADO");
  }

  const qualificationProblems = [];
  if (!hasValue(client.nome)) qualificationProblems.push("nome completo ausente");
  if (/^[a-f0-9]{24,}$/i.test(String(client.cidade || "").replace(/\s/g, ""))) qualificationProblems.push("campo Cidade preenchido com sequência hexadecimal/hash");
  if (digits(client.cep) && digits(contractNumber) && digits(client.cep) === digits(contractNumber)) qualificationProblems.push("CEP igual ao número do contrato");
  const email = normalizeText(client.email);
  const emailDomain = email.split("@")[1] || "";
  if (emailDomain && bankTokens(bank).some((token) => emailDomain.includes(token))) qualificationProblems.push("e-mail do contratante vinculado ao domínio da própria instituição");
  const secondaryClientFields = [client.rg, client.data_nascimento, client.endereco, client.bairro, client.estado, client.telefone, client.numero_beneficio];
  const missingClientFields = secondaryClientFields.filter((value) => !hasValue(value)).length;
  if (missingClientFields >= 5) qualificationProblems.push("demais campos cadastrais majoritariamente ausentes");
  if (qualificationProblems.length >= 2) {
    addFinding("ALTA", "client-qualification", "Contratante mal qualificado.", `${qualificationProblems.join("; ")}. Esses defeitos devem ser confrontados com os dados cadastrais e os fatores de autenticação efetivamente utilizados.`);
    addCheck("D", "qualificacao", "ALERTA", qualificationProblems.join("; "));
  } else if (qualificationProblems.length) {
    addFinding("MÉDIA", "client-qualification", "Qualificação cadastral incompleta.", `${qualificationProblems.join("; ")}.`);
    addCheck("D", "qualificacao", "ALERTA", qualificationProblems.join("; "));
  } else {
    addCheck("D", "qualificacao", "CONFERIDO");
  }

  const chain = chainScore(report);
  if (signature.presente === false) {
    addFinding("ALTA", "signature-absent", "Assinatura eletrônica não localizada.", "O arquivo analisado não apresentou assinatura eletrônica identificável. A instituição deve fornecer o instrumento assinado e sua trilha técnica completa.");
    addCheck("E", "assinatura", "ALERTA", "Assinatura não localizada.");
  } else {
    addCheck("E", "assinatura", hasValue(signature.data_hora_assinatura) ? "CONFERIDO" : "ALERTA");
  }
  if (signature.presente && embeddedMissing && (!hasValue(signature.tipo) || /simples|indeterminado/i.test(signature.tipo || ""))) {
    addFinding("MÉDIA", "simple-signature", "Assinatura eletrônica depende da cadeia de custódia.", "Não foi detectada certificação PAdES incorporada e o nível da assinatura é simples ou indeterminado. Isso não a invalida por si; impugnada a autoria, cabe ao banco comprovar autenticidade (STJ, Tema 1.061, CPC arts. 6º, 369 e 429, II)." );
  }
  if (chain.present < chain.total) {
    addFinding("INFO", "CUS1", "Referências documentais de rastreabilidade: limitações.", `Referências localizadas neste checklist: ${chain.present} de ${chain.total}. Não localizadas: ${chain.missing.join("; ")}. Essa contagem mede referências no material examinado, não valida autoria, integridade ou completude dos registros originais. Solicitar os registros de origem necessários à verificação.`);
  }
  addCheck("E", "cadeia-custodia", "INFORMATIVO", `${chain.present}/${chain.total} referências documentais; presença não equivale a validação.`);

  if (audit.chronologyInconsistent) {
    addFinding("ALTA", "chronology", "Carimbos de tempo não conciliados.", `A trilha registra eventos entre ${audit.firstTime || "horário não identificado"} e ${audit.lastTime || "horário não identificado"}, enquanto o campo da assinatura usa outro horário ou fuso. Os logs brutos devem esclarecer o fuso efetivamente aplicado.`);
    addCheck("E", "cronologia", "ALERTA", "Inconsistência temporal automática.");
  }
  if (audit.eventCount > 0 && audit.deviceIdentifiable === false) {
    addFinding("MÉDIA", "device-gap", "Dispositivo sem vínculo inequívoco com o hardware.", `A trilha informa ${audit.device || "sistema e navegador"}, mas não apresenta fabricante, modelo ou identificador físico legível.`);
    addCheck("E", "dispositivo", "ALERTA", "Hardware não individualizado.");
  }

  // Todas as distâncias à residência saem do confronto canônico. Com o confronto
  // recusado ou indisponível, nenhuma delas existe: sem achado, sem selo, sem
  // ponto no gráfico. Ver CRIT-01 da rodada 2.
  const confronto = report.confronto_geografico || montarConfrontoGeografico(report);
  const residenciaCalculada = confronto.status === STATUS_CONFRONTO.CALCULADO;
  const gpsDistance = residenciaCalculada ? distanciaKm(confronto.distancias.gps_residencia) : null;
  if (gpsDistance !== null && distanciaSuspeita(gpsDistance)) {
    addCheck("F", "gps-residencia", "ALERTA", "Distância exatamente igual a zero entre fontes independentes: dado suspeito, sem valor de coerência espacial.");
  } else if (gpsDistance !== null) {
    if (gpsDistance < 50) {
      addFinding("FAVORÁVEL", "gps-near-home", "GPS da assinatura próximo à referência residencial.", `A coordenada da assinatura fica a ${formatKm(gpsDistance)} do endereço de referência. Isoladamente, o dado favorece coerência espacial, mas não comprova autoria.`);
      addCheck("F", "gps-residencia", "PRÓ-BANCO", formatKm(gpsDistance));
    } else if (gpsDistance < 300) {
      addFinding("MÉDIA", "gps-home-distance", "GPS da assinatura exige contextualização.", `A assinatura aparece a ${formatKm(gpsDistance)} da residência. O deslocamento deve ser confrontado com data, horário e rotina do cliente.`);
      addCheck("F", "gps-residencia", "ALERTA", formatKm(gpsDistance));
    } else {
      addFinding("ALTA", "gps-home-distance", "GPS da assinatura distante da residência.", `A coordenada declarada fica a ${formatKm(gpsDistance)} da referência residencial. A distância não prova fraude sozinha, mas exige explicação e logs de localização.`);
      addCheck("F", "gps-residencia", "ALERTA", formatKm(gpsDistance));
    }
  } else if (confronto.status === STATUS_CONFRONTO.RECUSADO_CONFLITO) {
    addCheck("F", "gps-residencia", "INDETERMINADO", "Confronto recusado: endereço informado conflita com o do instrumento.");
  } else if (confronto.status === STATUS_CONFRONTO.INDISPONIVEL_NAO_INFORMADO) {
    addCheck("F", "gps-residencia", "INDETERMINADO", "Confronto indisponível: instrumento registra o endereço como não informado.");
  } else if (confronto.status === STATUS_CONFRONTO.REFERENCIA_MUNICIPAL) {
    // Referência em nível de município e pontos do ato no mesmo município: a
    // conferência que vale é a de município (abaixo), não a de quilômetros.
    addCheck("F", "gps-residencia", "INDETERMINADO", "Referência residencial em nível de município; os pontos do ato caem no mesmo município e a distância até o centroide não é aferida.");
  } else {
    addCheck("F", "gps-residencia", "INDETERMINADO", "Distância residencial indisponível.");
  }

  // Um GPS a poucas dezenas de km ainda pode cair num MUNICÍPIO diferente
  // do domicílio — o que importa mais para a diligência (correspondente
  // bancário, deslocamento) do que a distância bruta em km. Ver item 5 do
  // relatório técnico de 09/09/2026 (GPS a 41 km, "favorável" pela régua de
  // distância, mas em outro município).
  //
  // SaaS: o domicílio é a residência de referência (informada e geocodificada
  // pelo operador) quando o município dela é conhecido; a cidade do cadastro no
  // contrato fica como reserva. É a mesma referência das distâncias do § 5, e
  // o cadastro do contrato pode ser justamente o dado contestado.
  // Referência recusada por conflito com o instrumento não é domicílio: nesse
  // caso vale o município do cadastro. Foi assim que o sumário do dossiê C6
  // afirmou domicílio em Pedro II/PI três seções depois de o § 3 registrar
  // Manaquiri/AM.
  const referenciaUtilizavel = !["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(report.home?.estado_confronto);
  const referenciaMunicipio = referenciaUtilizavel ? report.home?.geo?.matchedCity || null : null;
  const domicilioCidade = referenciaMunicipio || client.cidade;
  const domicilioUf = referenciaMunicipio ? report.home?.geo?.matchedUf : client.estado;
  const gpsMunicipio = normalizeText(report.contractGeo?.municipio);
  const residenciaMunicipio = normalizeText(domicilioCidade);
  const ufsDiferentes = Boolean(report.contractGeo?.uf && domicilioUf && normalizeText(report.contractGeo.uf) !== normalizeText(domicilioUf));
  // INS1: no consignado INSS (IN 138 em diante), o correspondente tem de estar
  // na UF do domicílio. O domicílio é o mesmo do confronto geográfico do § 5.
  const regimeInss = extracted.regime_inss;
  const regimeComIn138 = Boolean(regimeInss && REGIMES_COM_IN138.has(regimeInss.codigo));
  const ufCorrespondente = String(extracted.correspondente?.uf || contract.correspondente?.uf || "").toUpperCase();
  if (regimeComIn138 && ufCorrespondente && domicilioUf && ufCorrespondente !== normalizeText(domicilioUf).toUpperCase()) {
    const cidadeCorrespondente = extracted.correspondente?.cidade || contract.correspondente?.cidade;
    addFinding("ALTA", "INS1", "Correspondente bancário de outra unidade da federação.", `O correspondente que originou a operação está em ${cidadeCorrespondente ? `${cidadeCorrespondente}/` : ""}${ufCorrespondente}, e o domicílio do beneficiário, em ${domicilioCidade ? `${domicilioCidade}/` : ""}${domicilioUf}${referenciaMunicipio ? " (residência de referência)" : ""}. ${DISPOSITIVOS_IN138.LOCAL_DOMICILIO.conferido ? `No consignado em benefício do INSS, a ${citarDispositivo("LOCAL_DOMICILIO")} exige local de contratação compatível com o domicílio do beneficiário.` : "No consignado em benefício do INSS, a IN PRES/INSS nº 138/2022 rege o local e a forma da contratação; o dispositivo que vincula o correspondente ao domicílio do beneficiário ainda não foi conferido no DOU pelo escritório e deve sê-lo antes do uso deste achado em juízo."}`);
  }
  if (gpsMunicipio && residenciaMunicipio && (gpsMunicipio !== residenciaMunicipio || ufsDiferentes)) {
    addFinding("MÉDIA", "gps-outro-municipio", "Ato praticado em município diverso do domicílio.", `A coordenada declarada no dossiê de contratação cai em ${report.contractGeo.municipio}${report.contractGeo.uf ? `/${report.contractGeo.uf}` : ""}, município diferente do domicílio do cliente (${domicilioCidade}${domicilioUf ? `/${domicilioUf}` : ""}${referenciaMunicipio ? ", residência de referência" : ""})${gpsDistance !== null && !distanciaSuspeita(gpsDistance) ? `, a ${formatKm(gpsDistance)}` : ""}. Verifique se a contratação ocorreu em loja de correspondente bancário ou por dispositivo de terceiro.${regimeComIn138 && ufsDiferentes && DISPOSITIVOS_IN138.LOCAL_DOMICILIO.conferido ? ` No consignado em benefício do INSS, a ${citarDispositivo("LOCAL_DOMICILIO")} exige local de contratação compatível com o domicílio do beneficiário.` : ""}`);
    addCheck("F", "gps-municipio", "ALERTA", `${report.contractGeo.municipio} ≠ ${domicilioCidade}`);
    // Município do GPS diverso do domicílio + correspondente identificado
    // no instrumento: a diligência natural é perguntar ao banco quem
    // operou aquele correspondente. Item 9.6 do relatório técnico de
    // 09/09/2026.
    if (contract.correspondente?.nome) {
      addDiligence("correspondente-operador", "Identificação do operador do correspondente", `Exigir do banco a identificação do operador do correspondente ${contract.correspondente.nome}${contract.correspondente.codigo ? ` (código ${contract.correspondente.codigo})` : ""} que conduziu a contratação em ${report.contractGeo.municipio}, o local físico do atendimento e o dispositivo utilizado.`);
    }
  } else if (gpsMunicipio && residenciaMunicipio) {
    addCheck("F", "gps-municipio", "PRÓ-BANCO", "Mesmo município do domicílio.");
  }

  // O instrumento declara o local do ato ("Local: Amparo - SP") e registra, no
  // mesmo bloco, a coordenada do ato. Quando ela cai em outro município, o
  // documento se contradiz sozinho, sem depender da residência informada.
  const localDeclarado = report.home?.local_emissao;
  const municipioDeclarado = normalizeText(localDeclarado?.municipio);
  const ufDeclaradaDiverge = Boolean(localDeclarado?.uf && report.contractGeo?.uf && normalizeText(localDeclarado.uf) !== normalizeText(report.contractGeo.uf));
  if (gpsMunicipio && municipioDeclarado && (gpsMunicipio !== municipioDeclarado || ufDeclaradaDiverge)) {
    const parEmissao = (report.confronto_enderecos?.pares || []).find((p) => p.id === "gps-x-emissao");
    const kmEmissao = parEmissao?.km ?? null;
    const gpsRotulo = `${report.contractGeo.municipio}${report.contractGeo.uf ? `/${report.contractGeo.uf}` : ""}`;
    const declaradoRotulo = `${localDeclarado.municipio}${localDeclarado.uf ? `/${localDeclarado.uf}` : ""}`;
    addFinding("MÉDIA", "gps-local-declarado", "Coordenada do ato em município diverso do local declarado no instrumento.", `O instrumento declara como local do ato ${declaradoRotulo} e registra, no mesmo bloco, a coordenada do ato, que cai em ${gpsRotulo}${kmEmissao !== null && !distanciaSuspeita(kmEmissao) ? `, a ${formatKm(kmEmissao)} da sede do município declarado` : ""}. As duas informações constam do próprio arquivo e não se conciliam: o local declarado e a coordenada registrada apontam municípios diferentes.`);
    addCheck("F", "gps-local-declarado", "ALERTA", `${gpsRotulo} ≠ ${declaradoRotulo}`);
  } else if (gpsMunicipio && municipioDeclarado) {
    addCheck("F", "gps-local-declarado", "PRÓ-BANCO", "Coordenada do ato no município declarado como local do ato.");
  }

  if (report.home?.estado_confronto === "DIVERGENCIA_CADASTRAL" || (report.home?.conflito && report.home?.estado_confronto !== "RECUSADO_CONFLITO")) {
    const conflito = report.home.conflito;
    const kmCadastral = report.home.distancia_divergencia_cadastral != null
      ? report.home.distancia_divergencia_cadastral
      : conflito?.km;
    const ufManual = conflito?.manual?.uf;
    const ufInst = conflito?.instrumento?.uf;
    const ufsDivergentes = ufManual && ufInst && ufManual !== ufInst;
    const severidade = (ufsDivergentes || (kmCadastral !== null && kmCadastral >= 300)) ? "ALTA" : "MÉDIA";
    const detalheKm = kmCadastral !== null ? `, a aproximadamente ${formatKm(kmCadastral)} de distância` : "";
    const textoManual = conflito?.manual?.texto || report.home.query || "endereço informado";
    const textoInst = [conflito?.instrumento?.cidade, conflito?.instrumento?.uf].filter(Boolean).join("/") || "município do contrato";
    addFinding(
      severidade,
      "divergencia-endereco-cadastral",
      "Divergência entre endereço declarado no instrumento e residência informada.",
      `O endereço fornecido como residência do cliente (${textoManual}) difere da qualificação cadastral registrada no contrato (${textoInst})${detalheKm}. O laudo analisa as distâncias para ambos os locais. Essa divergência pode indicar fraude cadastral na contratação ou desatualização documental.`
    );
    addCheck("F", "divergencia-cadastral", "ALERTA", `${textoManual} ≠ ${textoInst}`);
  }

  const ipCards = (report.ipAnalysis || []).map((ip, indice) => {
    const role = classifyIpRole(ip, report);
    const km = residenciaCalculada ? distanciaKm(confronto.distancias.ips_residencia[indice]?.km) : null;
    const valida = km !== null && !distanciaSuspeita(km) ? km : null;
    // `distance` do card também é sobrescrito: quem renderiza o card não pode
    // encontrar a distância bruta do enriquecimento.
    return buildIpCard({ ...ip, distance: valida, distancia_residencia: valida }, role, bank);
  });
  const accessIp = ipCards.find((ip) => ip.role === "access");
  const infrastructureIps = ipCards.filter((ip) => ["bank", "cdn", "infrastructure"].includes(ip.role));
  if (!ipCards.length) {
    addCheck("G", "triagem-ip", "ALERTA", "Nenhum IP classificado.");
  } else {
    addCheck("G", "triagem-ip", accessIp ? "CONFERIDO" : "INDETERMINADO", `${ipCards.length} IP(s); ${infrastructureIps.length} de infraestrutura.`);
  }

  let gpsIpDistance = null;
  if (accessIp?.geo && report.contractGeo) {
    gpsIpDistance = haversineKm(report.contractGeo.lat, report.contractGeo.lon, accessIp.geo.lat, accessIp.geo.lon);
    if (gpsIpDistance !== null && gpsIpDistance >= 300) {
      addFinding("ALTA", "gps-ip-conflict", "Contradição geográfica entre GPS e IP de acesso.", `O GPS da assinatura e a localização aproximada do IP ${accessIp.endereco} estão separados por ${formatKm(gpsIpDistance)}. CGNAT, VPN e roteamento podem interferir, mas a divergência deve ser explicada pelos logs da operadora e da plataforma.`);
      addCheck("G", "gps-contra-ip", "ALERTA", formatKm(gpsIpDistance));
    } else if (gpsIpDistance !== null && gpsIpDistance >= 50) {
      addFinding("MÉDIA", "gps-ip-conflict", "GPS e IP de acesso não são convergentes.", `A distância aproximada entre os dois pontos é ${formatKm(gpsIpDistance)}. A geolocalização de IP tem margem de erro e exige confirmação técnica.`);
      addCheck("G", "gps-contra-ip", "ALERTA", formatKm(gpsIpDistance));
    } else if (gpsIpDistance !== null) {
      addFinding("FAVORÁVEL", "gps-ip-compatible", "GPS e IP de acesso são geograficamente convergentes.", `A distância aproximada entre os pontos é ${formatKm(gpsIpDistance)}. A convergência favorece coerência espacial, sem comprovar autoria isoladamente.`);
      addCheck("G", "gps-contra-ip", "PRÓ-BANCO", formatKm(gpsIpDistance));
    }
  }

  const structuredIssues = Array.isArray(extracted.achados_irregularidade) ? extracted.achados_irregularidade : [];
  const sourceIssues = structuredIssues.length ? structuredIssues : (extracted.evidencias_irregularidade || []);
  for (const [index, rawIssue] of sourceIssues.entries()) {
    const issue = normalizeIssue(rawIssue, index);
    const mergedText = `${issue.titulo}. ${issue.texto}`;
    if (/metadados descritivos insuficientes/i.test(mergedText)) continue;
    if (/^(Ausência de endereço IP|Ausência de geolocalização GPS|Trilha de auditoria não identificada)/i.test(mergedText)) continue;
    addFinding(issue.gravidade === "MÉDIO" ? "MÉDIA" : issue.gravidade, issue.codigo, `${issue.titulo}.`, issue.texto, { grau: rawIssue?.grau, ancora: rawIssue?.ancora });
  }
  addCheck("H", "fundamentacao", "CONFERIDO", "Achados vinculados ao dever de informação, autenticidade, integridade e proteção de dados.");

  // Natureza da rede do endereço de acesso (utils/ipFaixa.js): hospedagem,
  // nuvem ou VPN na trilha de assinatura não é conexão de aparelho de consumidor.
  for (const ip of report.ipAnalysis || []) {
    if (!ip?.faixa?.alerta) continue;
    const papel = classifyIpRole(ip, report);
    if (papel === "bank" || papel === "cdn") continue;
    addFinding(
      "ALTA",
      "ip-infraestrutura",
      `Conexão de ${ip.faixa.rotulo} na trilha de contratação.`,
      `O endereço ${ip.endereco}${ip.rotulo ? ` (registrado como "${ip.rotulo}")` : ""} pertence a bloco classificado como ${ip.faixa.rotulo}: ${ip.faixa.motivo}. Rede de hospedagem, nuvem ou VPN não é rede de acesso residencial ou móvel. A classificação é feita pelo nome do titular do bloco e deve ser confirmada com o registro do bloco na data do ato e com os logs da plataforma.`,
      { grau: "CONSTATADO", ancora: { pagina: null, trecho: `endereço ${ip.endereco}` } }
    );
    addCheck("F", "ip-faixa", "ALERTA", `${ip.endereco}: ${ip.faixa.rotulo}.`);
    break;
  }
  // Origem da coordenada declarada: o PDF não distingue GPS do aparelho, IP e
  // cadastro, e a distância só prova presença se a fonte for o aparelho.
  if (report.contractGeo) {
    addDiligence("origem-coordenada", "Origem da coordenada declarada", "Exigir da plataforma a origem da coordenada registrada no ato (GPS do aparelho, geolocalização por IP ou dado cadastral), a precisão informada pelo sistema e o consentimento de localização do aparelho na sessão. Coordenada de cadastro ou de IP não demonstra presença física do contratante.");
  }

  if (accessIp) {
    addDiligence("ip-holder", "Identificação do titular da conexão", `Requisitar à operadora os dados da conexão vinculada ao IP ${accessIp.endereco}${accessIp.data_hora ? ` em ${accessIp.data_hora}` : signature.data_hora_assinatura ? ` na data/hora ${signature.data_hora_assinatura}` : " no intervalo registrado"}, mediante autorização judicial.`);
  }
  const issueCodes = new Set(sourceIssues.map((issue, index) => normalizeIssue(issue, index).codigo));
  // Diligências do regime INSS (ofício ao INSS e à Dataprev, DIB, demonstrativo
  // prévio) entram antes das genéricas: a página do sumário corta em sete.
  for (const d of extracted.regime_inss?.diligencias || []) addDiligence(d.chave, d.titulo, d.texto);
  if (signature.presente || audit.eventCount || issueCodes.has("LOG1")) {
    addDiligence("raw-logs", "Logs brutos da plataforma", "Exigir eventos completos, fuso, identificador de sessão, IP de cada etapa, fator de autenticação e política de retenção.");
  }
  if (missingEconomics.length || issueCodes.has("FIN1") || issueCodes.has("FIN2")) {
    addDiligence("full-contract", "Instrumento contratual completo", "Solicitar taxa anual quando o campo estiver em branco, campo de valor liberado ao cliente, demonstrativo do CET, qualificação completa e número/espécie do benefício quando aplicável.");
  }
  if (issueCodes.has("INT1")) {
    addDiligence("auth-code", "Explicitação do código de autenticação", `Solicitar o procedimento de validação do código de autenticação${signature.codigo_autenticacao_origem ? ` localizado em ${signature.codigo_autenticacao_origem}` : " declarado no material examinado"}, o arquivo original e, se houver hash, seu algoritmo e payload de referência. Código de autenticação e hash são elementos distintos.`);
  }
  if (issueCodes.has("CET1")) {
    addDiligence("cet-demo", "Demonstrativo de cálculo do CET", "Exigir valor em reais, percentual e base de cálculo de cada componente do fluxo, conforme dever de informação do CDC e da regulamentação do CMN sobre CET.");
  }
  if (issueCodes.has("TRB1")) {
    addDiligence("iof-proof", "Comprovante de recolhimento do IOF", "Exigir base de cálculo, prazo considerado e alíquotas aplicadas, para aferição do teto de 3,373% vigente para pessoa física na data da contratação.");
  }
  if (hashMismatch || hashMalformed || hashMissing || issueCodes.has("INT1") || signature.integridade_pos_assinatura === false) {
    addDiligence("payload", "Payload original assinado", "Solicitar o arquivo original, a metodologia de hash e os registros de preservação para resolver a questão de integridade.");
  }
  if (qualificationProblems.some((problem) => /e-mail/.test(problem))) {
    addDiligence("auth-email", "Confirmação do e-mail de autenticação", `Verificar se ${client.email} foi efetivamente usado no aceite ou se representa preenchimento institucional/padrão.`);
  }
  if (audit.deviceIdentifiable === false && audit.eventCount > 0) {
    addDiligence("device", "Identificação técnica do dispositivo", "Solicitar fabricante, modelo, identificador disponível e método de vinculação da biometria/selfie ao aparelho utilizado.");
  }
  if (issueCodes.has("ELA2")) {
    addDiligence("biometric-original", "Arquivo original da captura biométrica", "Solicitar o arquivo original não comprimido da imagem biométrica com metadados EXIF íntegros, logs de transmissão do dispositivo capturador e prova técnica do teste de vivacidade (liveness test).");
  }
  if (findings.length || issueCodes.has("CUS1")) {
    addDiligence("expert", "Perícia na cadeia de custódia", "Confrontar o instrumento, os logs, os hashes e os carimbos de tempo antes do uso como prova técnica definitiva.");
  }
  if (!diligences.length) {
    addDiligence("review", "Revisão humana do conjunto documental", "Conferir o contrato original e os anexos antes de concluir pela ausência de irregularidades materiais.");
  }

  // Gravidade e, dentro dela, eixo da tese (ver eixosAchado.js). No laudo do
  // dossiê C6, "metadados descritivos ausentes" saía antes da falta de prova do
  // crédito e da fragilidade biométrica.
  const orderedFindings = ordenarAchados(findings, { codigo: (f) => f.key, gravidade: (f) => f.severity });

  /*
   * ─── D5 · projeção canônica ─────────────────────────────────────────────────
   *
   * O laudo FD-20260917 trazia 20 achados no corpo e 15 no sumário, e um item
   * no sumário sem correspondente no corpo. Um mecanismo só explica as duas
   * coisas: este ponto cortava a lista em 15 sem avisar, e a lista cortada é
   * maior do que a do corpo, porque reúne os achados estruturados da extração
   * com os que o próprio sumário produz (assinatura simples, hash, geografia).
   *
   * `projecao` é agora a lista canônica, a mesma que o corpo do laudo passa a
   * renderizar. O sumário consome essa projeção e não constrói item próprio.
   * Quando a página não comporta todos, o corte é declarado e contado aqui, e
   * impresso na própria página. Truncar não é defeito; truncar em silêncio é.
   */
  const LIMITE_SUMARIO = 15;
  const omitidos = orderedFindings.slice(LIMITE_SUMARIO);
  const corte = omitidos.length
    ? {
      limite: LIMITE_SUMARIO,
      total: orderedFindings.length,
      exibidos: LIMITE_SUMARIO,
      omitidos: omitidos.length,
      codigos: omitidos.map((f) => f.key),
      gravidades: [...new Set(omitidos.map((f) => f.severity))],
      aviso: `Os ${orderedFindings.length} achados do corpo do laudo estão no § de achados técnicos. Esta página exibe os ${LIMITE_SUMARIO} de maior gravidade; ${omitidos.length} ${omitidos.length === 1 ? "foi omitido" : "foram omitidos"} por limite de página (${omitidos.map((f) => f.key).join(", ")}).`,
    }
    : null;
  // A página do sumário resume; o corpo publica integral. Antes, o corte de 560
  // caracteres era aplicado na criação do achado e, com o corpo passando a ler
  // a projeção, levava o resumo para dentro do detalhe.
  const displayFindings = orderedFindings.slice(0, LIMITE_SUMARIO).map((f) => ({ ...f, text: f.text }));
  // Ausência de achado é estado de interface, não item de lista: entrar na
  // lista do sumário sem entrar na projeção quebraria a igualdade que o § de
  // achados e esta página agora mantêm.
  const semAchados = orderedFindings.length === 0;

  const geoItems = [];
  if (!(report.confronto_enderecos?.pares || []).length && gpsDistance !== null && !distanciaSuspeita(gpsDistance)) {
    geoItems.push({ label: "GPS · assinatura", distance: gpsDistance, role: "gps", location: report.contractGeo?.endereco || "coordenada do log" });
  }
  const selectedIps = [
    accessIp,
    ipCards.find((ip) => ip.role === "bank"),
    ipCards.find((ip) => ip.role === "cdn"),
    ipCards.find((ip) => ip.role === "infrastructure"),
    ipCards.find((ip) => ip.role === "unknown"),
  ].filter((ip, index, list) => ip && list.indexOf(ip) === index).slice(0, 3);
  // Verificação de endereços por pares: cada ponto do gráfico diz o que compara
  // (IP, endereço do instrumento, endereço informado no laudo, GPS do ato), e
  // nenhum deles afirma domicílio. Ver utils/confrontoEnderecos.js.
  const pares = report.confronto_enderecos?.pares || [];
  const paresMedidos = pares.filter((par) => distanciaKm(par.km) !== null);
  for (const par of paresMedidos) {
    geoItems.push({ label: ROTULO_CURTO[par.id] || par.rotulo, distance: distanciaKm(par.km), texto: par.texto, role: par.papel, referencia: "par", par: par.id, precisao: par.precisao });
  }

  // Sem residência aferida, o gráfico passa a medir cada IP até o GPS declarado
  // da assinatura. Essa verificação não depende da residência e não pode sumir
  // do laudo junto com ela.
  const referenciaDoGrafico = residenciaCalculada ? "residencia" : "gps";
  const rotuloIp = (ip) => (ip.role === "access" ? `${ip.geo?.isp || "IP"} · acesso` : ip.role === "bank" ? `${bank} · servidor` : ip.role === "cdn" ? `${ip.geo?.isp || "CDN"} · CDN` : `${ip.geo?.isp || "IP"} · rede`);
  if (!paresMedidos.length && !residenciaCalculada && report.contractGeo) {
    for (const ip of selectedIps) {
      const original = (report.ipAnalysis || []).find((o) => o.endereco === ip.endereco);
      const km = distanciaKm(original?.distanceToSignature);
      if (km !== null && !distanciaSuspeita(km)) {
        geoItems.push({ label: rotuloIp(ip), distance: km, role: ip.role, location: locationLabel(ip.geo), referencia: "gps" });
      }
    }
  }
  for (const ip of residenciaCalculada && !paresMedidos.length ? selectedIps : []) {
    if (ip.distancia_residencia !== null && ip.distancia_residencia !== undefined) {
      geoItems.push({
        label: ip.role === "access" ? `${ip.geo?.isp || "IP"} · acesso` : ip.role === "bank" ? `${bank} · servidor` : ip.role === "cdn" ? `${ip.geo?.isp || "CDN"} · CDN` : `${ip.geo?.isp || "IP"} · rede`,
        distance: ip.distancia_residencia,
        role: ip.role,
        location: locationLabel(ip.geo),
      });
    }
  }

  /*
   * ─── D2 · a conclusão geográfica contradizia o corpo do laudo ───────────────
   *
   * A frase de ausência integral era o VALOR INICIAL desta variável, não um
   * ramo. Sobrevivia sempre que nenhum dos ramos abaixo disparasse, e foi o que
   * ocorreu no laudo FD-20260917: com a residência recusada não há distância, e
   * nenhum IP foi classificado como infraestrutura. O laudo então afirmou
   * "ausência integral de trilha de rede/localização" na pág. 22, onze páginas
   * depois de imprimir seis eventos, quatro IPs completos e três coordenadas.
   *
   * Dois estados que compartilhavam um texto passam a ser distintos. Confronto
   * não realizado por recusa da referência não é insumo geográfico ausente no
   * arquivo. A frase de ausência só pode ser emitida quando as duas contagens
   * abaixo forem zero, e elas passam a ser campos da resposta, não texto.
   */
  const eventosDaTrilha = report.extracted?.trilha_eventos?.eventos || [];
  const numero = (valor) => {
    if (valor == null || typeof valor === "boolean" || String(valor).trim() === "") return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  };
  // Par completo: latitude 0 é coordenada válida, e latitude sem longitude não
  // localiza nada. O teste anterior usava `e.latitude || e.coordenada`, que
  // descartava o zero e aceitava meia coordenada.
  const temPar = (lat, lon) => numero(lat) !== null && numero(lon) !== null && Math.abs(numero(lat)) <= 90 && Math.abs(numero(lon)) <= 180;

  // Contagens de EVENTOS da trilha, que é o que a frase de ausência afirma.
  const eventosComIp = eventosDaTrilha.filter((e) => hasValue(e.ip)).length;
  const eventosComCoordenada = eventosDaTrilha.filter((e) => temPar(e.lat ?? e.latitude, e.lon ?? e.longitude)).length;

  // Insumos adicionais, contados à parte. Somá-los às contagens de eventos com
  // `||` misturava grandezas diferentes e inflava a trilha com IPs que o
  // enriquecimento inventariou fora dela.
  const ipsInventariados = (report.ipAnalysis || []).length;
  const geoAssinatura = report.extracted?.geolocalizacao_assinatura || {};
  const coordenadaDeclarada = temPar(report.contractGeo?.lat, report.contractGeo?.lon)
    || temPar(geoAssinatura.latitude, geoAssinatura.longitude);

  const semInsumoGeografico = eventosComIp === 0
    && eventosComCoordenada === 0
    && ipsInventariados === 0
    && !coordenadaDeclarada;

  // O motivo é consultado, não presumido. Referência recusada e IP sem
  // geolocalização são causas distintas de o confronto não fechar, e atribuir
  // sempre à referência era repetir, em menor escala, o erro que o D2 corrige.
  const referenciaIndisponivel = ["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(report.home?.estado_confronto);
  const ipSemGeolocalizacao = ipsInventariados > 0 && (report.ipAnalysis || []).every((ip) => !temPar(ip.geo?.lat, ip.geo?.lon));
  const motivoDoConfronto = referenciaIndisponivel
    ? "a referência residencial não está disponível para o confronto (ver § 3)"
    : ipSemGeolocalizacao
      ? "os endereços IP inventariados não foram geolocalizados"
      : !coordenadaDeclarada
        ? "o documento não declara coordenada do ato para confrontar com a rede"
        : "os elementos disponíveis não formaram par comparável";

  const itensInventario = [
    eventosComIp ? `${eventosComIp} ${eventosComIp === 1 ? "evento com IP" : "eventos com IP"}` : null,
    eventosComCoordenada ? `${eventosComCoordenada} ${eventosComCoordenada === 1 ? "evento com coordenada" : "eventos com coordenada"}` : null,
    !eventosComIp && ipsInventariados ? `${ipsInventariados} ${ipsInventariados === 1 ? "endereço IP inventariado" : "endereços IP inventariados"}` : null,
    !eventosComCoordenada && coordenadaDeclarada ? "coordenada declarada no documento" : null,
  ].filter(Boolean);
  const inventario = itensInventario.join(", ");
  const verboInventario = itensInventario.length > 1 ? "constam" : "consta";

  let synthesis = semInsumoGeografico
    ? "Não foram localizados elementos geográficos suficientes na extração disponível para confronto entre GPS e IP de acesso. A limitação da extração não comprova ausência desses elementos no original."
    : `O confronto entre GPS e IP de acesso não foi concluído porque ${motivoDoConfronto}. O arquivo NÃO é omisso quanto a rastros geográficos: ${inventario} ${verboInventario} do dossiê, com detalhe nas seções anteriores. Confronto não realizado e insumo ausente são estados distintos, e este é o primeiro.`;
  if (gpsIpDistance !== null && gpsIpDistance >= 50) {
    synthesis = `A tese técnica se concentra na divergência de ${formatKm(gpsIpDistance)} entre o GPS da assinatura e o IP de acesso provável. IPs classificados como servidor, CDN ou infraestrutura não devem ser usados para localizar o consumidor.`;
  } else if (gpsIpDistance !== null) {
    synthesis = `GPS e IP de acesso estão a aproximadamente ${formatKm(gpsIpDistance)}. A convergência é favorável à coerência espacial, mas não substitui a prova de autoria. IPs de infraestrutura foram separados do acesso do usuário.`;
  } else if (paresMedidos.some(par => par.id === "gps-x-ip")) {
    const par = paresMedidos.find(par => par.id === "gps-x-ip");
    synthesis = `O GPS declarado e o ponto retornado pela consulta de geolocalização do IP registrado no dossiê foram comparados: cerca de ${par.km >= 1 ? `${Math.round(par.km)} km` : formatKm(par.km)}${par.metodo?.para?.evidencias?.length ? ` (${par.metodo.para.evidencias.length} registros desse endereço)` : ""}. O papel desse IP na sessão não foi determinado nesta análise; a distância descreve os pontos consultados, cuja margem de erro não foi informada, e não comprova autoria, presença física ou localização histórica. Consulte a memória de cálculo e as fontes do par GPS × IP. ${referenciaIndisponivel ? "O confronto residencial permanece indisponível e é independente dessa comparação." : "O confronto residencial é avaliado separadamente."}`;
  } else if (infrastructureIps.length) {
    synthesis = `${infrastructureIps.length} IP(s) foram classificados como infraestrutura. Esses endereços não localizam o consumidor; a conclusão depende de identificar o IP efetivamente associado à sessão do signatário.`;
  }

  const methods = Array.isArray(signature.metodos_autenticacao) && signature.metodos_autenticacao.length
    ? signature.metodos_autenticacao.join(" e ")
    : signature.metodos_descritos_no_fluxo?.length
      ? `nenhum método operacional registrado; ${signature.metodos_descritos_no_fluxo.map((m) => m.rotulo).join(", ").toLowerCase()}`
      : "nenhum método operacional registrado";
  const introSubject = `Leitura crítica do exame do arquivo "${compact(report.file?.name || "documento analisado", 100)}", do contrato nº ${contractNumber} de ${bank}.`.replace(/\.\s*\.$/, ".");
  const intro = `${introSubject} O placar separa alertas, pontos favoráveis e diligências conforme os elementos efetivamente presentes no documento.`;

  return {
    reportId: report.reportId || "Laudo sem protocolo",
    custodyChecklist: { present: chain.present, total: chain.total },
    bank,
    contractNumber,
    cpf,
    intro,
    meta: {
      contractDate: hasValue(contract.data_contrato) ? contract.data_contrato : "data não identificada",
      signatureDate: hasValue(signature.data_hora_assinatura) ? signature.data_hora_assinatura : "sem data/hora registrada",
      methods,
      sha256: shortHash(report.hashes?.sha256),
      size: report.file?.sizeKB ? `${report.file.sizeKB} KB` : "tamanho não identificado",
      pages: metadata?.totalPages ? `${metadata.totalPages} página${metadata.totalPages === 1 ? "" : "s"}` : "páginas não identificadas",
    },
    checks,
    counts: {
      domains: 8,
      irregularities: findings.length,
      // D2: as contagens que autorizam ou proíbem a frase de ausência integral
      // saem como número na resposta, não apenas embutidas no texto da síntese.
      eventos_com_ip: eventosComIp,
      eventos_com_coordenada: eventosComCoordenada,
      ips_inventariados: ipsInventariados,
      favorable: favorable.length,
      diligences: Math.min(diligences.length, 7),
    },
    findings: displayFindings,
    semAchados,
    allFindings: orderedFindings,
    // Projeção canônica: a lista única que o corpo e o sumário renderizam. O
    // corte é nulo quando tudo coube.
    projecao: orderedFindings,
    graus: contarPorGrau(orderedFindings),
    corte,
    favorable,
    geo: {
      items: geoItems.slice(0, 4),
      status: confronto.status,
      // D2: as duas contagens que autorizam ou proíbem a frase de ausência
      // integral são campo da resposta, não texto reescrito na conclusão.
      insumos: {
        eventos_com_ip: eventosComIp,
        eventos_com_coordenada: eventosComCoordenada,
        ips_inventariados: ipsInventariados,
        coordenada_declarada: coordenadaDeclarada,
      },
      referencia: pares.length ? "pares" : referenciaDoGrafico,
      pares,
      modo: pares.length ? "pares" : "referencia",
      description: pares.length
        ? descreverPares(pares, paresMedidos, residenciaCalculada, confronto)
        : residenciaCalculada
        ? geoItems.length
          ? "Distâncias aproximadas até a referência residencial. O GPS representa o ponto declarado no ato; os IPs foram separados entre acesso provável e infraestrutura."
          : "Não houve coordenadas suficientes para construir o confronto geográfico."
        : geoItems.length
          ? `Distância aproximada de cada IP até o GPS declarado da assinatura${report.contractGeo?.municipio ? ` (${report.contractGeo.municipio}${report.contractGeo.uf ? `/${report.contractGeo.uf}` : ""})` : ""}. As distâncias à residência não foram calculadas porque a referência residencial foi recusada ou está indisponível (ver § 3).`
          : "Distâncias à residência não calculadas: a referência residencial foi recusada ou está indisponível (ver § 3). Não há IP geolocalizado e GPS declarado para o confronto entre os dois.",
    },
    ipCards: ipCards.slice(0, 3),
    synthesis,
    diligences: diligences.slice(0, 7),
    suspicionGrade: computeSuspicionGrade(findings),
    disclaimer: `Sumário automático do laudo ForenseDoc ${report.reportId || "sem protocolo"}. As classificações técnicas decorrem apenas dos dados localizados no arquivo analisado e devem ser confirmadas com o artefato original, logs e revisão humana. Apoio à análise jurídica; não substitui prova pericial.`,
  };
}

// Nome do campo mantido por compatibilidade com resultados persistidos.
// A quantidade de lacunas não é uma escala de suspeição do contrato.
function computeSuspicionGrade() {
  return { label: "REVISÃO DOCUMENTAL NECESSÁRIA", color: "#64748b", rationale: "Conferir as evidências e diligências de cada item. As classificações individuais orientam a revisão; não atestam fraude, autoria ou validade jurídica." };
}

export { formatKm };

const MOTIVO_CURTO = {
  RECUSADO_CONFLITO: "ele conflita com o endereço do instrumento",
  INDISPONIVEL_NAO_INFORMADO: "o instrumento registra o endereço do contratante como não informado",
  SEM_REFERENCIA: "não há coordenada de referência residencial",
  SEM_PONTOS: "não há coordenada de assinatura nem de IP para confrontar",
};

/** Rótulo curto de cada par, para caber no gráfico do sumário. */
const ROTULO_CURTO = {
  "ip-x-instrumento": "IP × instrumento",
  "laudo-x-instrumento": "Laudo × instrumento",
  "ip-x-laudo": "IP × laudo",
  "gps-x-ip": "GPS × IP",
};

function descreverPares(pares, medidos, residenciaCalculada, confronto) {
  const lista = medidos.map((par) => `${par.rotulo}: ${par.texto}`).join("; ");
  const faltando = pares.filter((par) => par.indisponivel?.length).map((par) => `${par.rotulo} (${descreverIndisponibilidade(par)})`);
  const precisaoMunicipio = medidos.some((par) => par.precisao === "municipio");
  return [
    lista ? `Confronto de endereços, dois a dois: ${lista}.` : "Não houve pontos suficientes para confrontar endereços.",
    precisaoMunicipio ? "O endereço do instrumento foi resolvido em nível de município, porque a instituição não registrou o endereço do contratante." : null,
    residenciaCalculada ? null : `O endereço informado na geração do laudo não é usado como domicílio: ${MOTIVO_CURTO[confronto.status] || "referência residencial recusada ou indisponível"} (ver § 3).`,
    faltando.length ? `Não aferidos: ${faltando.join("; ")}.` : null,
  ].filter(Boolean).join(" ");
}
