// Utilitários de formatação e leitura compartilhados pelo motor pericial.
// Portados do motor de geração (backend/server.js) sem alteração de regra.
import { moneyToCents } from "./numberParsing.js";

export function cleanPdfBase64(value) {
  return String(value || "").replace(/^data:application\/pdf;base64,/, "").trim();
}

export function cleanMetadataText(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    const decoded = Buffer.from(text, "latin1").toString("utf8");
    return (decoded.match(/[ÃÂ�]/g) || []).length < (text.match(/[ÃÂ�]/g) || []).length ? decoded : text;
  } catch {
    return text;
  }
}

export function formatPdfDate(value) {
  const raw = cleanMetadataText(value);
  if (!raw) return null;
  const match = raw.match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?([+-])?(\d{2})?'?(\d{2})?/);
  if (!match) return raw;
  const [, year, month, day, hour = "00", minute = "00", second = "00", sign, tzHour, tzMinute] = match;
  const zone = sign && tzHour ? ` UTC${sign}${tzHour}:${tzMinute || "00"}` : "";
  return `${day}/${month}/${year} ${hour}:${minute}:${second}${zone}`;
}

export function parseFormattedPdfDate(value) {
  const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
}

export function parsePtDateTime(value) {
  const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(?:-\s*)?(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
}

export function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return (match[1] || match[0]).replace(/\s+/g, " ").trim();
  }
  return null;
}

export function allMatches(text, pattern) {
  return Array.from(text.matchAll(pattern)).map((m) => (m[1] || m[0]).replace(/\s+/g, " ").trim());
}

export function titleCaseName(value) {
  if (!value) return null;
  return value
    .replace(/\bCPF\b.*$/i, "")
    .replace(/\bRG\b.*$/i, "")
    .replace(/\bCELULAR\b.*$/i, "")
    .toLowerCase()
    .replace(/\b([a-záàâãéêíóôõúç])/g, (m) => m.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

export function stripDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeMoney(value) {
  if (!value) return null;
  return String(value).startsWith("R$") ? value : `R$ ${value}`;
}

export function valuesEqualMoney(a, b) {
  const left = moneyToCents(a);
  const right = moneyToCents(b);
  return left !== null && right !== null && left === right;
}

export function normalizePercent(value) {
  if (!value) return null;
  return String(value).includes("%") ? value.replace(/\s+/g, "") : `${value}%`;
}

export function centsToMoney(cents) {
  if (!Number.isFinite(cents)) return null;
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function nBR(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function plural(value, singular, pluralText) {
  const number = Number(value);
  const formatted = nBR(number);
  return `${formatted ?? value} ${number === 1 ? singular : pluralText}`;
}

export function parsePtDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

export function daysBetweenPtDates(start, end) {
  const a = parsePtDate(start);
  const b = parsePtDate(end);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

export function humanYearsMonthsFromDays(days) {
  if (!Number.isFinite(days) || days < 0) return null;
  const years = Math.floor(days / 365.2425);
  const months = Math.round((days - years * 365.2425) / 30.4375);
  return `${plural(years, "ano", "anos")} e ${plural(months, "mês", "meses")}`;
}
