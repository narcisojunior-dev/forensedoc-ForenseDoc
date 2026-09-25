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
    // "\b" é ASCII: em "são paulo" a fronteira caía dentro da palavra e o
    // resultado era "SÃO Paulo". Letra inicial é a que vem depois de algo que
    // não é letra.
    .replace(/(^|[^\p{L}])(\p{L})/gu, (m, antes, letra) => antes + letra.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

export function stripDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Forma can\u00f4nica do e-mail para grava\u00e7\u00e3o e busca.
 *
 * O banco trata `Joao@x.com` e `joao@x.com` como valores diferentes, ent\u00e3o sem
 * normalizar o mesmo endere\u00e7o vira duas contas: quem se cadastrou com mai\u00fascula
 * n\u00e3o consegue logar digitando min\u00fascula, e a checagem de unicidade do cadastro
 * \u00e9 contorn\u00e1vel. Precisa ser aplicada em TODOS os pontos que gravam ou
 * consultam usu\u00e1rio por e-mail \u2014 cadastro, login, recupera\u00e7\u00e3o de senha e
 * convite de membro.
 */
export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
