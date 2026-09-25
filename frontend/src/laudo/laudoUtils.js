import { ordenarAchados } from "./eixosAchado.js";
import { classificarGrauProcessual, GRAUS } from "./grausConclusao.js";

// Utilitários de apresentação do laudo técnico pericial. Portados do motor de
// geração (frontend/src/ForenseDoc.jsx) sem alteração de regra.
// O PDF do servidor usa uma cópia destas regras em
// backend/src/reports/laudoApresentacao.js: manter as duas iguais (o teste
// backend/tests/reportPdfParidadeTela.test.js compara as saídas).

export function classifyHashString(s) {
  if (!s || typeof s !== "string") return null;
  const v = s.trim();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuidAny = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidV4.test(v)) return { format: "UUID v4", isHash: false, detalhe: "Identificador UUID versão 4, gerado aleatoriamente, sem relação criptográfica com o conteúdo do documento" };
  if (uuidAny.test(v)) return { format: "UUID", isHash: false, detalhe: "Identificador UUID, sem relação criptográfica com o conteúdo do documento" };
  if (/^[0-9a-fA-F]{64}$/.test(v)) return { format: "SHA-256", isHash: true, detalhe: "Cadeia hexadecimal de 64 caracteres, compatível com SHA-256" };
  if (/^[0-9a-fA-F]{40}$/.test(v)) return { format: "SHA-1", isHash: true, detalhe: "Cadeia hexadecimal de 40 caracteres, compatível com SHA-1" };
  if (/^[0-9a-fA-F]{32}$/.test(v)) return { format: "MD5", isHash: true, detalhe: "Cadeia hexadecimal de 32 caracteres, compatível com MD5" };
  return { format: "Formato não reconhecido", isHash: false, detalhe: "Cadeia não corresponde a nenhum formato de hash criptográfico conhecido" };
}

export function shortHash(value, left = 12, right = 8) {
  const text = String(value || "");
  return text.length > left + right + 3 ? `${text.slice(0, left)}…${text.slice(-right)}` : text;
}

export function nBR(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value ?? null;
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
    return `O contrato não traz hash criptográfico conferível. Há, no rodapé do instrumento, código de autenticação declarado pelo emissor, examinado no § 4, que não é redutível a hexadecimal, Base64 ou Base32 e não é conferível por método público. O hash SHA-256 calculado por este sistema sobre o arquivo original é o indicado acima e passa a servir como impressão digital de referência do documento para fins de cadeia de custódia.`;
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

export function normalizeIssue(issue, index = 0) {
  if (issue && typeof issue === "object") {
    const codigo = issue.codigo || `AUTO${index}`;
    return {
      codigo,
      gravidade: issue.gravidade || issue.severidade || "MÉDIA",
      grau: issue.grau || classificarGrauProcessual(codigo),
      titulo: cleanIssueText(issue.titulo || "Achado técnico").replace(/\.+$/, ""),
      texto: cleanIssueText(issue.texto || issue.detalhe || ""),
    };
  }
  const text = cleanIssueText(issue);
  const [title, ...rest] = text.split(/\. +/);
  const codigo = `LEGADO${index}`;
  return {
    codigo,
    gravidade: "MÉDIA",
    grau: classificarGrauProcessual(codigo),
    titulo: (title || "Achado técnico").replace(/\.+$/, ""),
    texto: rest.join(". "),
  };
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

/**
 * D5 · o corpo do laudo e o sumário renderizam a MESMA lista.
 *
 * Antes, o § 8 lia `achados_irregularidade` e o sumário lia a saída de
 * `buildIrregularitySummary`, que reúne aqueles achados e mais os que ela mesma
 * produz (assinatura simples, hash, geografia). Daí o laudo FD-20260917 trazer
 * 20 itens no corpo, 15 no sumário e um item no sumário sem correspondente no
 * corpo. Recebida a projeção canônica, ela é a fonte única; `extracted` fica
 * como reserva para laudos antigos, emitidos antes deste campo existir.
 *
 * @param {object} extracted
 * @param {Array<{severity:string, key:string, title:string, text:string}>} [projecao]
 */
export function reportIssues(extracted = {}, projecao = null) {
  // Projeção vazia é resposta, não ausência de resposta. Testar `.length` fazia
  // `[]` cair no caminho legado e ressuscitar achados que a projeção excluiu
  // deliberadamente (os de residência, quando o confronto é recusado).
  if (Array.isArray(projecao)) {
    return ordenarAchados(projecao.filter((f) => !achadoFinanceiro(f.key)).map((f) => ({
      codigo: f.key,
      gravidade: f.severity,
      grau: f.grau || classificarGrauProcessual(f.key),
      titulo: cleanIssueText(f.title || "Achado técnico").replace(/\.+$/, ""),
      texto: cleanIssueText(f.text || ""),
    })));
  }
  const structured = Array.isArray(extracted.achados_irregularidade) ? extracted.achados_irregularidade : [];
  const legacy = structured.length ? [] : (extracted.evidencias_irregularidade || []);
  const seen = new Set();
  const issues = [...structured, ...legacy].map(normalizeIssue).filter((issue) => {
    if (achadoFinanceiro(issue.codigo)) return false;
    if (!issue.titulo && !issue.texto) return false;
    if (seen.has(issue.codigo)) return false;
    seen.add(issue.codigo);
    return true;
  });
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

export function comparisonStatusColor(status) {
  if (status === "CONFIRMADO") return "#3ddc97";
  if (status === "NAO_CONFRONTAVEL") return "#8595a8";
  return "#f06363";
}

export function severityColor(value) {
  if (/CR[IÍ]TICO/i.test(value || "")) return "#f06363";
  if (/ALTO/i.test(value || "")) return "#f5853f";
  if (/M[EÉ]DIO|ATEN/i.test(value || "")) return "#f2b03d";
  if (/CONFERIDO|OK|BAIXO/i.test(value || "")) return "#3ddc97";
  return "#8595a8";
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function riskFromDistance(km) {
  if (km === null || km === undefined) return { label: "INDETERMINADO", color: "#8595a8", bg: "rgba(133,149,168,0.08)", score: 0 };
  if (km < 50)   return { label: "RISCO BAIXO",    color: "#3ddc97", bg: "rgba(61,220,151,0.08)",  score: 1 };
  if (km < 300)  return { label: "RISCO MODERADO", color: "#f2b03d", bg: "rgba(242,176,61,0.09)",  score: 2 };
  if (km < 1000) return { label: "RISCO ALTO",     color: "#f5853f", bg: "rgba(245,133,63,0.09)",  score: 3 };
  return             { label: "RISCO CRÍTICO", color: "#f06363", bg: "rgba(240,99,99,0.09)",   score: 4 };
}

export function riskFromDistanceWithHistory(km, historico) {
  if (historico?.suppressDistanceRisk) {
    return { label: historico.label || "REGISTRO ALTERADO", color: "#8595a8", bg: "rgba(133,149,168,0.08)", score: 0, suppressed: true, nota: historico.note };
  }
  return { ...riskFromDistance(km), suppressed: false, nota: historico?.note || null };
}

/**
 * Valor interpolado antes de um ponto final. Nome de operadora termina em
 * ponto ("TIM S.A."), e a frase ficava "provedor TIM S.A..": além do erro de
 * redação, a higiene do laudo recusa ponto duplicado e bloqueava o PDF.
 */
export function semPontoFinal(valor) {
  return valor == null ? valor : String(valor).replace(/\.+\s*$/, "");
}

/** Rótulos de apresentação; os códigos persistidos continuam estáveis. */
export function labelModalidade(value) {
  return ({COMPRA_CARTAO: "Compra com cartão", SAQUE_CARTAO_CONSIGNADO: "Saque parcelado do cartão consignado", CDC_COM_GARANTIA: "Crédito direto ao consumidor com garantia", CREDITO_PESSOA_JURIDICA: "Crédito para pessoa jurídica"})[value] || value;
}

export function formatMetadataWarning(value) {
  return String(value || "").replace(/^[A-Z]+\d+[A-Z0-9-]*\s+(?:CRÍTICO|CRITICO|ALTA|ALTO|MÉDIA|MÉDIO|MEDIA|MEDIO|INFO):\s*/u, "");
}
