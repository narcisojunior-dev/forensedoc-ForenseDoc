/**
 * Regras de apresentação do laudo compartilhadas entre a tela e o PDF.
 *
 * A tela de análise (frontend/src/laudo/LaudoForense.jsx) e o PDF do servidor
 * (services/reportPdfService.js) leem o mesmo `result` persistido. As decisões
 * de apresentação, como o confronto de hash, a classificação dos achados em
 * grupos e o saneamento do sumário legado, viviam só no navegador. O PDF ficava
 * com menos dados e, em alguns pontos, com conclusões diferentes das da tela.
 *
 * Cópia de frontend/src/laudo/laudoUtils.js, frontend/src/laudo/produto.js
 * (marcarOrigem) e frontend/src/laudo/montarRelatorio.js (sanearSumario), no
 * mesmo regime de distancia.js e eixosAchado.js: manter as cópias iguais.
 */

import { ordenarAchados } from "../engine/eixosAchado.js";
import { classificarGrauProcessual, contarPorGrau, GRAUS, ROTULOS_GRAU, DESCRICAO_GRAU } from "../engine/grausConclusao.js";
import { distanciaKm, distanciaSuspeita } from "../utils/distancia.js";

export function classifyHashString(s) {
  if (!s || typeof s !== "string") return null;
  const v = s.trim();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuidAny = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidV4.test(v)) return { format: "UUID v4", isHash: false };
  if (uuidAny.test(v)) return { format: "UUID", isHash: false };
  if (/^[0-9a-fA-F]{64}$/.test(v)) return { format: "SHA-256", isHash: true };
  if (/^[0-9a-fA-F]{40}$/.test(v)) return { format: "SHA-1", isHash: true };
  if (/^[0-9a-fA-F]{32}$/.test(v)) return { format: "MD5", isHash: true };
  return { format: "Formato não reconhecido", isHash: false };
}

/**
 * Confronto entre o hash declarado no documento e o calculado pelo servidor.
 * Mesma decisão do § 1 da tela: só compara SHA-256 com SHA-256.
 */
export function confrontoHash(declarado, calculado) {
  const cls = classifyHashString(declarado);
  const calc = String(calculado || "");
  const comparavel = cls?.format === "SHA-256" && /^[a-fA-F0-9]{64}$/.test(calc);
  const confere = comparavel && declarado.replace(/\s/g, "").toUpperCase() === calc.toUpperCase();
  const resultado = !comparavel ? "NÃO COMPARÁVEL" : confere ? "HASHES CONFEREM" : "DIVERGÊNCIA DETECTADA";
  const nota = !comparavel
    ? `Comparação não realizada: o formato declarado é ${cls?.format || "não identificado"}. São necessários hashes do mesmo algoritmo e escopo; o campo calculado pelo sistema é SHA-256. Isso não determina a validade da assinatura.`
    : confere
      ? "O hash informado no documento confere integralmente com o hash calculado localmente sobre o arquivo. Integridade consistente entre o valor declarado e o conteúdo verificado."
      : "O hash informado no documento diverge do hash calculado localmente sobre o arquivo. A divergência deve ser interpretada com cautela técnica: em PDFs assinados, o hash de assinatura refere-se ao conteúdo no instante da assinatura e pode não coincidir com o recálculo sobre o arquivo finalizado. Recomenda-se verificação pericial complementar antes de qualquer conclusão sobre adulteração.";
  return { formato: cls?.format || null, ehHash: Boolean(cls?.isHash), comparavel, confere, resultado, nota };
}

export function shortHash(value, left = 12, right = 8) {
  const text = String(value || "");
  return text.length > left + right + 3 ? `${text.slice(0, left)}…${text.slice(-right)}` : text;
}

export function nBR(value, digits = 0) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return value ?? null;
  return number.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCnpj(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function formatCpf(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function labelHashState(value) {
  const labels = {
    AUSENTE: "Ausente",
    DECLARADO_NAO_CONFERIVEL: "Declarado, porém não conferível por método público",
    DECLARADO_CONFERIVEL: "Declarado e conferível",
  };
  return labels[value] || value;
}

export function labelProvenance(value, procedencia = null) {
  const labels = {
    EXPORTACAO_SISTEMA_PROCESSUAL: "Exportação de sistema processual",
    REIMPRESSAO_POSTERIOR_PROVAVEL: "Reimpressão posterior provável",
    NATIVO_PROVAVEL: "Nativo provável",
    RE_RENDERIZACAO_JUDICIAL: "Re-renderização judicial",
    ARQUIVO_DERIVADO: "Arquivo derivado",
  };
  const sistema = [procedencia?.sistema, procedencia?.tribunal].filter(Boolean).join("/");
  return labels[value] ? `${labels[value]}${sistema ? ` (${sistema})` : ""}` : value;
}

export function noteForDeclaredHashState(state, calc, assinatura = null) {
  // Código de autenticação rotulado (protocolo, número único), sem hash: o texto
  // não pode chamar o protocolo de hash nem situá-lo no "rodapé".
  if (assinatura?.codigo_autenticacao_declarado && !assinatura?.hash_documento_assinado && assinatura?.codigo_autenticacao_origem && !/rodap/i.test(assinatura.codigo_autenticacao_origem)) {
    return `O documento não apresenta hash criptográfico declarado. Apresenta apenas código de autenticação (${assinatura.codigo_autenticacao_declarado}, ${assinatura.codigo_autenticacao_origem}) conferível exclusivamente pelo próprio emissor${assinatura.codigo_autenticacao_url_verificacao ? `, em ${assinatura.codigo_autenticacao_url_verificacao}` : ""}. O hash SHA-256 calculado por este sistema sobre o arquivo original é o indicado acima e passa a servir como impressão digital de referência do documento para fins de cadeia de custódia.`;
  }
  if (state === "DECLARADO_NAO_CONFERIVEL") {
    return "O contrato não traz hash criptográfico conferível. Há, no rodapé do instrumento, código de autenticação declarado pelo emissor, examinado no § 4, que não é redutível a hexadecimal, Base64 ou Base32 e não é conferível por método público. O hash SHA-256 calculado por este sistema sobre o arquivo original é o indicado acima e passa a servir como impressão digital de referência do documento para fins de cadeia de custódia.";
  }
  if (state === "DECLARADO_CONFERIVEL") {
    return `O contrato traz hash declarado pelo emissor, conferido no § 4. O hash SHA-256 calculado por este sistema sobre o arquivo original é ${calc}.`;
  }
  return "O contrato não traz hash criptográfico declarado pelo emissor. O hash SHA-256 calculado por este sistema sobre o arquivo original é o indicado acima e passa a servir como impressão digital de referência do documento para fins de cadeia de custódia.";
}

export function cleanIssueText(value) {
  return semCifras(String(value || "")
    .replace(/\b(?:CET1|FIN\d|IMG\d|INT\d|TRB\d|CAD\d|CUS\d|LOG\d)\s+(?:ALTA|MEDIA|MÉDIA|MÉDIO|INFO|CRITICO|CRÍTICO)\s*:\s*/g, "")
    .replace(/\b(?:CET1|FIN\d|IMG\d|INT\d|TRB\d|CAD\d|CUS\d|LOG\d)\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim());
}

function normalizeIssue(issue, index = 0) {
  if (issue && typeof issue === "object") {
    return {
      codigo: issue.codigo || `AUTO${index}`,
      gravidade: issue.gravidade || issue.severidade || "MÉDIA",
      titulo: cleanIssueText(issue.titulo || "Achado técnico").replace(/\.+$/, ""),
      texto: cleanIssueText(issue.texto || issue.detalhe || ""),
    };
  }
  const text = cleanIssueText(issue);
  const [title, ...rest] = text.split(/\. +/);
  return { codigo: `LEGADO${index}`, gravidade: "MÉDIA", titulo: (title || "Achado técnico").replace(/\.+$/, ""), texto: rest.join(". ") };
}

/*
 * Cifra que sobra no texto de um achado ou de uma diligência.
 *
 * Alguns achados que ficam no laudo, como a ausência de comprovante de
 * transferência, citavam o valor da operação no meio da frase. O achado
 * continua: o que sai é a cifra. As orações inteiras de valor são removidas,
 * para a frase seguir correndo bem; a cifra solta que escapar vira uma marca
 * explícita, porque publicar o número é o que não pode acontecer.
 */
const CIFRA = "R\\$\\s?\\d[\\d.]*(?:,\\d{1,2})?";
const CLAUSULAS_DE_VALOR = [
  new RegExp(`,?\\s*n[oa]\\s+(?:valor|montante|import[âa]ncia)\\s+de\\s+${CIFRA}`, "gi"),
  new RegExp(`,?\\s*de\\s+${CIFRA}\\s+(?=na\\s|para\\s)`, "gi"),
  new RegExp(`\\s*\\(\\s*${CIFRA}\\s*\\)`, "g"),
];

export function semCifras(texto) {
  let t = String(texto || "");
  for (const re of CLAUSULAS_DE_VALOR) t = t.replace(re, "");
  return t
    .replace(new RegExp(CIFRA, "g"), "valor suprimido")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

/**
 * Achados de valor, taxa e custo ficam fora do laudo.
 *
 * O objeto do laudo é a verificação e a validação da cadeia de custódia. O que
 * a operação cobra não confirma nem afasta autoria e integridade do documento,
 * e levar esses números ao juízo abre uma discussão revisional que este exame
 * não fez. DAT fica fora da lista: data de contratação divergente é cronologia,
 * não preço.
 *
 * O corte é de apresentação, não de motor: o resultado gravado continua
 * completo, e laudos já emitidos passam a sair sem os valores ao serem
 * reabertos ou reexportados.
 *
 * SEG2, SEG5, SEG6, SEG7 e SEG8 tratam de prêmio, pró-labore e diferença de
 * centavos: são preço do seguro. SEG1, SEG3, SEG4 e SEG9 seguem no laudo,
 * porque tratam de carência, vigência, papéis das partes e rotulagem.
 */
const CODIGOS_FINANCEIROS = /^(CET\d|FIN\d|PRZ\d|TRB\d|TET\d|RMC\d|TAR\d|SEG[25678](?!\d)|economics)/i;

export function achadoFinanceiro(codigo) {
  return CODIGOS_FINANCEIROS.test(String(codigo || ""));
}

/** Verificações e diligências do sumário que existem só pelo eixo financeiro. */
const CHECKS_FINANCEIROS = new Set(["dados-economicos"]);
const DILIGENCIAS_FINANCEIRAS = new Set(["cet-demo", "iof-proof"]);

/*
 * A diligência do instrumento completo pedia taxa anual, valor liberado e
 * demonstrativo do CET. O pedido continua, sem os três itens que o laudo já
 * não examina.
 */
const DILIGENCIA_INSTRUMENTO = "full-contract";
const TEXTO_INSTRUMENTO_COMPLETO =
  "Solicitar o instrumento contratual completo e legível, com a qualificação integral do contratante, as páginas de assinatura e o número/espécie do benefício quando aplicável.";

/** Remove do sumário o que decorre do exame econômico. */
function semFinanceiro(sumario) {
  // O que fica também não publica cifra: o sumário imprime o texto do achado
  // como ele foi gravado, sem passar pelo saneamento do § de achados.
  const semEixo = (lista) =>
    Array.isArray(lista)
      ? lista.filter((f) => !achadoFinanceiro(f.key)).map((f) => (f?.text ? { ...f, text: semCifras(f.text) } : f))
      : lista;
  const projecao = semEixo(sumario.projecao ?? sumario.allFindings);
  const findings = semEixo(sumario.findings);
  const saneado = {
    ...sumario,
    findings,
    allFindings: semEixo(sumario.allFindings),
    favorable: semEixo(sumario.favorable),
    checks: Array.isArray(sumario.checks) ? sumario.checks.filter((c) => !CHECKS_FINANCEIROS.has(c.key)) : sumario.checks,
    diligences: Array.isArray(sumario.diligences)
      ? sumario.diligences
          .filter((d) => !DILIGENCIAS_FINANCEIRAS.has(d.key))
          .map((d) =>
            d.key === DILIGENCIA_INSTRUMENTO
              ? { ...d, text: TEXTO_INSTRUMENTO_COMPLETO }
              : d?.text ? { ...d, text: semCifras(d.text) } : d)
      : sumario.diligences,
    intro: typeof sumario.intro === "string" ? semCifras(sumario.intro) : sumario.intro,
    synthesis: typeof sumario.synthesis === "string" ? semCifras(sumario.synthesis) : sumario.synthesis,
  };
  if (sumario.projecao !== undefined) saneado.projecao = semEixo(sumario.projecao);
  if (sumario.corte) saneado.corte = recontarCorte(sumario.corte, projecao || [], findings || []);
  return saneado;
}

/**
 * Lista única de achados do corpo do laudo (D5). Com a projeção canônica, ela
 * é a fonte; sem ela, o legado de `extracted`. Projeção vazia é resposta.
 */
export function reportIssues(extracted = {}, projecao = null) {
  if (Array.isArray(projecao)) {
    return ordenarAchados(projecao.filter((f) => !achadoFinanceiro(f.key)).map((f) => ({
      codigo: f.key,
      gravidade: f.severity,
      grau: f.grau || classificarGrauProcessual(f.key, f.severity),
      titulo: cleanIssueText(f.title || "Achado técnico").replace(/\.+$/, ""),
      texto: cleanIssueText(f.text || ""),
      ...(f.ancora ? { ancora: f.ancora } : {}),
    })));
  }
  const structured = Array.isArray(extracted.achados_irregularidade) ? extracted.achados_irregularidade : [];
  const legacy = structured.length ? [] : (extracted.evidencias_irregularidade || []);
  const seen = new Set();
  const issues = [...structured, ...legacy].map((raw) => {
    const issue = normalizeIssue(raw);
    if (raw && typeof raw === "object") {
      if (raw.grau) issue.grau = raw.grau;
      if (raw.ancora) issue.ancora = raw.ancora;
    }
    return issue;
  }).filter((issue) => {
    if (achadoFinanceiro(issue.codigo)) return false;
    if (!issue.titulo && !issue.texto) return false;
    if (seen.has(issue.codigo)) return false;
    seen.add(issue.codigo);
    return true;
  }).map((issue) => ({
    ...issue,
    grau: issue.grau || classificarGrauProcessual(issue.codigo, issue.gravidade),
  }));
  return ordenarAchados(issues);
}

export function issueBucket(issue) {
  const code = String(issue.codigo || "");
  const text = `${issue.titulo || ""} ${issue.texto || ""}`;
  if (/^INS\d/.test(code)) return classificarGrauProcessual(code) === GRAUS.CONSTATADO ? "instrumento" : "lacunas";
  if (/FIN3/i.test(code) || /\bcar[eê]ncia\b|contexto econ[oô]mico/i.test(text)) return "contexto";
  if (/^(LIB|BIO|ASS|TRL|TZ)/.test(code)) return "lacunas";
  if (/^SEG/.test(code)) return "instrumento";
  if (/INT|LOG|CUS|IMG|OCR|assinatura|hash|c[oó]digo|reimpress|selfie|biometr|trilha|cust[oó]dia/i.test(`${code} ${text}`)) return "lacunas";
  return "instrumento";
}

export const GRUPOS_ACHADOS = [
  ["instrumento", "Inconsistências do instrumento"],
  ["lacunas", "Lacunas probatórias a suprir pelo banco"],
  ["contexto", "Contexto econômico"],
];

export function extractCnjFromName(name) {
  const match = String(name || "").match(/(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})/);
  return match ? `${match[1]}-${match[2]}.${match[3]}.${match[4]}.${match[5]}.${match[6]}` : null;
}

export function labelComparisonStatus(status) {
  const labels = {
    CONFIRMADO: "CONFIRMADO",
    NAO_LOCALIZADO: "NÃO LOCALIZADO",
    NAO_CONFRONTAVEL: "NÃO CONFRONTÁVEL",
    DIVERGENTE: "DIVERGENTE",
  };
  return labels[status] || status;
}

/** Nome de operadora termina em ponto ("TIM S.A."): evita o ponto duplicado. */
export function semPontoFinal(valor) {
  return valor == null ? valor : String(valor).replace(/\.+\s*$/, "");
}

export function labelModalidade(value) {
  return ({ COMPRA_CARTAO: "Compra com cartão", SAQUE_CARTAO_CONSIGNADO: "Saque parcelado do cartão consignado", CDC_COM_GARANTIA: "Crédito direto ao consumidor com garantia", CREDITO_PESSOA_JURIDICA: "Crédito para pessoa jurídica" })[value] || value;
}

export function formatMetadataWarning(value) {
  return String(value || "").replace(/^[A-Z]+\d+[A-Z0-9-]*\s+(?:CRÍTICO|CRITICO|ALTA|ALTO|MÉDIA|MÉDIO|MEDIA|MEDIO|INFO):\s*/u, "");
}

/** D6: o rótulo diz se o valor veio do instrumento ou foi calculado. */
export function marcarOrigem(rotulo, origem) {
  if (origem === "CALCULADO_PELO_SISTEMA") return `${rotulo} · calculado pelo sistema`;
  if (origem === "EXTRAIDO_DO_INSTRUMENTO") return `${rotulo} · extraído do instrumento`;
  return rotulo;
}

// ─── Saneamento do sumário legado (montarRelatorio.js) ───────────────────────

const CHAVES_DISTANCIA_RESIDENCIA = new Set(["gps-near-home", "gps-home-distance"]);

function geoMedidoAteOGps(geo, ipAnalysis, contractGeo) {
  if (geo.modo === "pares") return { ...geo, items: (geo.items || []).filter((i) => distanciaKm(i.distance) !== null) };
  const valida = (km) => distanciaKm(km) !== null && !distanciaSuspeita(km);
  const items = geo.referencia === "gps"
    ? (geo.items || []).filter((i) => i.referencia === "gps" && valida(i.distance))
    : contractGeo
      ? ipAnalysis
          .filter((ip) => valida(ip.distanceToSignature))
          .slice(0, 3)
          .map((ip) => ({ label: `${ip.geo?.isp || "IP"} · rede`, distance: distanciaKm(ip.distanceToSignature), role: "access", referencia: "gps" }))
      : [];
  const local = contractGeo?.municipio ? ` (${contractGeo.municipio}${contractGeo.uf ? `/${contractGeo.uf}` : ""})` : "";
  return {
    ...geo,
    referencia: "gps",
    items,
    description: items.length
      ? `Distância aproximada de cada IP até o GPS declarado da assinatura${local}. As distâncias à residência não foram calculadas porque a referência residencial foi recusada ou está indisponível (ver § 3).`
      : "Distâncias à residência não calculadas: a referência residencial foi recusada ou está indisponível (ver § 3). Não há IP geolocalizado e GPS declarado para o confronto entre os dois.",
  };
}

function recontarCorte(corte, projecao, findings) {
  if (!corte) return null;
  const exibidos = new Set(findings.map((f) => f.key));
  const omitidos = projecao.filter((f) => !exibidos.has(f.key));
  if (!omitidos.length) return null;
  const codigos = omitidos.map((f) => f.key);
  return {
    ...corte,
    total: projecao.length,
    exibidos: findings.length,
    omitidos: omitidos.length,
    codigos,
    gravidades: [...new Set(omitidos.map((f) => f.severity))],
    aviso: `Os ${projecao.length} achados do corpo do laudo estão no § de achados técnicos. Esta página exibe os ${findings.length} de maior gravidade; ${omitidos.length} ${omitidos.length === 1 ? "foi omitido" : "foram omitidos"} por limite de página (${codigos.join(", ")}).`,
  };
}

/**
 * Sumário persistido por versões anteriores do motor pode trazer distância à
 * residência calculada a partir de nulo. Sem confronto válido, a tela retira
 * esses itens; o PDF tem de retirar os mesmos.
 */
/**
 * O placar de graus é gravado na análise sobre a lista inteira. Os cortes
 * abaixo (eixo financeiro, distância à residência) tiram achados da projeção
 * que o corpo do laudo imprime, e o placar precisa contar o que sobrou: o laudo
 * FD-20260923 dizia 10 indícios no sumário e 4 no § 6.
 */
export function sanearSumario(sumario, home, ipAnalysis = [], contractGeo = null) {
  const saneado = sanearSemGraus(sumario, home, ipAnalysis, contractGeo);
  if (!saneado || !saneado.graus) return saneado;
  return { ...saneado, graus: contarPorGrau(saneado.projecao ?? saneado.allFindings ?? []) };
}

function sanearSemGraus(sumario, home, ipAnalysis = [], contractGeo = null) {
  if (!sumario) return sumario;
  // O corte do eixo financeiro vale para todo sumário, independentemente do que
  // aconteceu com a referência residencial.
  const base = semFinanceiro(sumario);
  const recusado = ["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(home?.estado_confronto);
  const semDistancia = distanciaKm(contractGeo?.distance) === null && ipAnalysis.every((ip) => distanciaKm(ip.distance) === null);
  const valida = (km) => distanciaKm(km) !== null && !distanciaSuspeita(km);
  if (base.geo?.modo === "pares") {
    return { ...base, geo: { ...base.geo, items: (base.geo.items || []).filter((i) => distanciaKm(i.distance) !== null) } };
  }
  if (!recusado && !semDistancia) {
    return { ...base, geo: base.geo ? { ...base.geo, items: (base.geo.items || []).filter((i) => valida(i.distance)) } : base.geo };
  }
  const semResidencia = (lista = []) => lista.filter((f) => !CHAVES_DISTANCIA_RESIDENCIA.has(f.key));
  const projecao = semResidencia(base.projecao || base.allFindings);
  const findings = semResidencia(base.findings);
  return {
    ...base,
    findings,
    allFindings: semResidencia(base.allFindings),
    projecao,
    corte: recontarCorte(base.corte, projecao, findings),
    favorable: semResidencia(base.favorable),
    checks: (base.checks || []).map((c) => (c.key === "gps-residencia" ? { ...c, status: "INDETERMINADO", detail: "Distância à residência não calculada." } : c)),
    geo: base.geo ? geoMedidoAteOGps(base.geo, ipAnalysis, contractGeo) : base.geo,
    ipCards: (base.ipCards || []).map((card) => ({
      ...card,
      distance: null,
      text: String(card.text || "").replace(/, [\d.,]+ km da referência residencial/, ""),
    })),
  };
}
