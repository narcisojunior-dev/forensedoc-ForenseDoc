// Confronto entre o contrato periciado e o PDF do processo judicial.
// Portado do motor de geração (backend/server.js).
import { moneyToCents, percentToNumber } from "./numberParsing.js";
import { firstMatch, normalizePercent, stripDiacritics, valuesEqualMoney } from "./format.js";

function normalizeProcessText(value) {
  return String(value || "")
    .replace(/[\u00A0\u202F\u2009\u2007]/g, " ")
    .replace(/\u2212/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function monetaryVariants(value) {
  const cents = moneyToCents(value);
  if (cents === null) return [];
  const br = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [`R$ ${br}`, `R$${br}`, br, br.replace(/\./g, "")];
}

function containsMonetaryValue(text, value) {
  const normalized = normalizeProcessText(text);
  return monetaryVariants(value).some((variant) => normalized.includes(variant));
}

function percentVariants(value) {
  const number = percentToNumber(value);
  if (!Number.isFinite(number)) return [];
  const br = number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dot = br.replace(",", ".");
  return [`${br}%`, `${br} %`, `${dot}%`, `${dot} %`];
}

function containsPercentValue(text, value) {
  const normalized = normalizeProcessText(text);
  return percentVariants(value).some((variant) => normalized.includes(variant));
}

function dateVariants(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return [];
  const [, day, month, year] = match;
  return [`${day}/${month}/${year}`, `${day}.${month}.${year}`, `${year}-${month}-${day}`];
}

function containsDateValue(text, value) {
  const normalized = normalizeProcessText(text);
  return dateVariants(value).some((variant) => normalized.includes(variant));
}

function compactSnippet(value, max = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function containsLoose(text, value) {
  if (!value) return false;
  const normalizedText = stripDiacritics(String(text || "")).toUpperCase();
  const normalizedValue = stripDiacritics(String(value || "")).toUpperCase();
  return normalizedText.includes(normalizedValue);
}

function processSnippetAround(text, pattern, radius = 360) {
  const match = text.match(pattern);
  if (!match) return null;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return compactSnippet(text.slice(start, end));
}

export function compareProcessWithContract(processText, extracted) {
  const text = normalizeProcessText(processText);
  const flat = text;
  const contrato = extracted?.contrato || {};
  const cliente = extracted?.cliente || {};
  const assinatura = extracted?.assinatura || {};
  const confirmations = [];
  const divergences = [];
  const observations = [];

  const normalizePersonName = (value) => stripDiacritics(String(value || "").toUpperCase()).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const normalizeCompanyName = (value) => stripDiacritics(String(value || "").toUpperCase())
    .replace(/\bS[.\/]?\s?A\.?\b/g, "SA")
    .replace(/\b(BANCO|SA|LTDA|FINANCEIRA|CREDITO|FINANCIAMENTO|INVESTIMENTO|INSTITUICAO)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
  const normalizeDigitsOnly = (value) => String(value || "").replace(/\D/g, "");
  const normalizeField = (label, value) => {
    if (/banco|institui/i.test(label)) return normalizeCompanyName(value);
    if (/cpf|cnpj|contrato|benef/i.test(label)) return normalizeDigitsOnly(value);
    if (/autor|cliente|nome/i.test(label)) return normalizePersonName(value);
    return stripDiacritics(String(value || "").toUpperCase()).replace(/\s+/g, " ").trim();
  };
  const confirm = (label, value, pattern = null) => {
    if (value === null || value === undefined || value === "") {
      confirmations.push({ label, contrato: null, processo: "NÃO CONFRONTÁVEL", status: "NAO_CONFRONTAVEL" });
      return;
    }
    let found = false;
    if (pattern) {
      found = pattern.test(flat);
    } else if (/valor|parcela|total|saldo/i.test(label)) {
      found = containsMonetaryValue(flat, value);
    } else if (/taxa|cet/i.test(label)) {
      found = containsPercentValue(flat, value);
    } else if (/vencimento|data/i.test(label)) {
      found = containsDateValue(flat, value);
    } else if (/cpf|cnpj|contrato|benef/i.test(label)) {
      const needle = normalizeDigitsOnly(value);
      found = !!needle && normalizeDigitsOnly(flat).includes(needle);
    } else {
      found = normalizeField(label, flat).includes(normalizeField(label, value));
    }
    confirmations.push({ label, contrato: value, processo: found ? "LOCALIZADO" : "NÃO LOCALIZADO", status: found ? "CONFIRMADO" : "NAO_LOCALIZADO" });
  };

  confirm("Número do contrato", contrato.numero, contrato.numero ? new RegExp(String(contrato.numero).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : null);
  confirm("Autor/cliente", cliente.nome);
  confirm("CPF do cliente", cliente.cpf, cliente.cpf ? new RegExp(String(cliente.cpf).replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1\\.?$2\\.?$3-?$4")) : null);
  confirm("Banco réu", contrato.banco);
  confirm("Matrícula/benefício", cliente.matricula_inss);
  confirm("Forma de aceite", assinatura.forma_aceite);

  const processDeclaredTotal = firstMatch(flat, [
    /contrata[cç][aã]o\s+indevida\s+do\s+empr[eé]stimo\s+consignado\s+de\s+n[.ºo]*\s*[A-Z0-9.\-\/ ]{3,40}?,?\s+no\s+valor\s+total\s+de\s+(R\$\s*[\d.]+,\d{2})/i,
    /contrato\s+de\s+n[.ºo]*\s*[A-Z0-9.\-\/ ]{3,40}?[,\s]+no\s+valor\s+total\s+de\s+(R\$\s*[\d.]+,\d{2})/i,
  ]);
  if (processDeclaredTotal && contrato.valor_contratado && !valuesEqualMoney(processDeclaredTotal, contrato.valor_contratado)) {
    const sameAsSaldo = valuesEqualMoney(processDeclaredTotal, contrato.saldo_devedor_refinanciado);
    divergences.push({
      label: "Valor tratado como total na narrativa processual",
      contrato: contrato.valor_contratado,
      processo: processDeclaredTotal,
      severidade: sameAsSaldo ? "ATENÇÃO" : "DIVERGÊNCIA",
      detalhe: sameAsSaldo
        ? `O valor mencionado no processo coincide com o saldo devedor/refinanciado (${contrato.saldo_devedor_refinanciado}), não com o valor total da operação (${contrato.valor_contratado}).`
        : "O valor mencionado no processo difere do valor total extraído da CCB.",
      trecho: processSnippetAround(flat, /valor\s+total\s+de\s+R\$\s*[\d.]+,\d{2}/i),
    });
  }

  const tedValue = firstMatch(flat, [/COMPROVANTE\s+DE\s+TRANSA[ÇC][ÃA]O\s+BANC[ÁA]RIA[\s\S]{0,650}?Valor:\s*(R\$\s*[\d.]+,\d{2})/i]);
  if (tedValue && contrato.valor_liberado && !valuesEqualMoney(tedValue, contrato.valor_liberado)) {
    divergences.push({
      label: "Valor do comprovante de transferência x valor liberado na CCB",
      contrato: contrato.valor_liberado,
      processo: tedValue,
      severidade: "ATENÇÃO",
      detalhe: "O comprovante juntado aos autos informa valor diferente do valor liberado indicado na CCB. A diferença deve ser conferida com extrato, TED e quadro financeiro da operação.",
      trecho: processSnippetAround(flat, /COMPROVANTE\s+DE\s+TRANSA[ÇC][ÃA]O\s+BANC[ÁA]RIA[\s\S]{0,650}?Valor:\s*R\$\s*[\d.]+,\d{2}/i),
    });
  }

  const demonstrativoBlock = processSnippetAround(flat, /demonstrativo|custo\s+efetivo\s+total|CET/i, 900) || flat;
  const processCetMensal = normalizePercent(firstMatch(demonstrativoBlock, [
    /CET\s*(?:mensal|a\.?m\.?)\s*[:\-]?\s*([\d,.]+%?)/i,
    /Custo\s+Efetivo\s+Total[\s\S]{0,160}?([\d,.]+\s*%)\s*a\.?m\.?/i,
  ]));
  const processCetAnual = normalizePercent(firstMatch(demonstrativoBlock, [
    /CET\s*(?:anual|a\.?a\.?)\s*[:\-]?\s*([\d,.]+%?)/i,
    /Custo\s+Efetivo\s+Total[\s\S]{0,220}?(?:[\d,.]+\s*%\s*a\.?m\.?\s*\/\s*)?([\d,.]+\s*%)\s*a\.?a\.?/i,
  ]));
  for (const [label, contractValue, processValue] of [
    ["CET mensal da CCB x demonstrativo/processo", contrato.cet_mensal, processCetMensal],
    ["CET anual da CCB x demonstrativo/processo", contrato.cet_anual, processCetAnual],
  ]) {
    if (contractValue && processValue && stripDiacritics(contractValue).replace(/\s/g, "") !== stripDiacritics(processValue).replace(/\s/g, "")) {
      divergences.push({
        label,
        contrato: contractValue,
        processo: processValue,
        severidade: "DIVERGÊNCIA",
        detalhe: "O CET localizado no demonstrativo ou nos autos diverge do CET extraído da cédula. Uma das informações oficiais de custo deve ser esclarecida.",
        trecho: processSnippetAround(flat, /CET|Custo\s+Efetivo\s+Total/i),
      });
    }
  }

  for (const [label, value] of [
    ["Valor da parcela", contrato.valor_parcela],
    ["Valor total da operação", contrato.valor_contratado],
    ["Saldo devedor/refinanciado", contrato.saldo_devedor_refinanciado],
    ["Taxa mensal", contrato.taxa_juros_mensal],
    ["Taxa anual", contrato.taxa_juros_anual],
    ["CET mensal", contrato.cet_mensal],
    ["CET anual", contrato.cet_anual],
    ["Primeiro vencimento", contrato.data_primeiro_vencimento],
    ["Último vencimento", contrato.data_ultimo_vencimento],
  ]) {
    if (value) confirm(label, value);
  }

  if (/JULGO\s+IMPROCEDENTE/i.test(flat)) {
    observations.push({
      label: "Resultado processual localizado",
      detalhe: "O processo contém sentença de improcedência relacionada ao contrato examinado. O laudo técnico não substitui a valoração jurídica nem altera, por si só, o resultado processual.",
      trecho: processSnippetAround(flat, /JULGO\s+IMPROCEDENTE[\s\S]{0,220}?contrato\s+de\s+n[ºo.]*\s*\d+/i),
    });
  }

  const pending = confirmations.filter((item) => item.status === "NAO_LOCALIZADO");
  const scopeNote = "O confronto verifica correspondência documental entre o arquivo periciado e a peça do processo. Não atesta regularidade da operação, autenticidade da assinatura, nem supre os itens eliminatórios da cadeia de custódia examinados no § 4.";
  const status = divergences.length
    ? "DIVERGÊNCIAS A CONFERIR"
    : pending.length
      ? "CONFRONTO PARCIAL"
      : "Correspondência documental confirmada nos campos confrontáveis";
  return {
    status,
    status_note: pending.length
      ? `Campos pendentes de localização automática: ${pending.map((item) => item.label).join(", ")}. ${scopeNote}`
      : scopeNote,
    confirmations,
    divergences,
    observations,
  };
}
