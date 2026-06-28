export function cleanPdfBase64(value) {
  return String(value || "").replace(/^data:application\/pdf;base64,/, "").trim();
}

export function cleanMetadataText(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    const decoded = Buffer.from(text, "latin1").toString("utf8");
    return (decoded.match(/[ÃÂ]/g) || []).length < (text.match(/[ÃÂ]/g) || []).length ? decoded : text;
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
