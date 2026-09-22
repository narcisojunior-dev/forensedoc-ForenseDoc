import { firstMatch, stripDiacritics } from "./stringUtils.js";

// Distância em km entre dois pontos (fórmula de Haversine). Portado de
// frontend/src/utils/geo.js — o worker precisa calcular o confronto
// geográfico do §5, que antes só existia no navegador. As duas cópias são
// funções puras idênticas; não vale acoplar os builds por elas.
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

// Classificação de risco pela distância (mesmas faixas do frontend).
export function riskFromDistance(km) {
  if (km === null || km === undefined) return { label: "INDETERMINADO", score: 0 };
  if (km < 50) return { label: "RISCO BAIXO", score: 1 };
  if (km < 300) return { label: "RISCO MODERADO", score: 2 };
  if (km < 1000) return { label: "RISCO ALTO", score: 3 };
  return { label: "RISCO CRÍTICO", score: 4 };
}

export function normalizeGeoText(value) {
  return stripDiacritics(value)
    .replace(/\bS\s+JOAO\b/gi, "Sao Joao")
    .replace(/\bN[uú]mero\s+do\s+Endere[cç]o\b/gi, " ")
    .replace(/\bComplemento\b.*$/gi, " ")
    .replace(/\bPromotor\b.*$/gi, " ")
    .replace(/\bAtendente\b.*$/gi, " ")
    .replace(/\bSem informa[cç][aã]o\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueValues(values) {
  return Array.from(new Set(values.map((v) => normalizeGeoText(v)).filter(Boolean)));
}

export function buildGeocodeQueries(rawQuery) {
  const q = normalizeGeoText(rawQuery);
  const city = firstMatch(q, [/cidade\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:bairro|endereco|cep|estado)\b)/i]);
  const bairro = firstMatch(q, [/bairro\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:endereco|cep|cidade|estado)\b)/i]);
  const estado = firstMatch(q, [/estado\s*[:\-]?\s*([A-Z]{2})\b/i, /\b(PI|MA|CE|PA|BA|PE|PB|RN|AL|SE|TO|GO|DF|MG|SP|RJ|ES|PR|SC|RS|MS|MT|RO|AC|AM|RR|AP)\b/i]);
  const cep = firstMatch(q, [/\b(\d{2}\.?\d{3}-?\d{3})\b/]);
  const street = firstMatch(q, [
    /endereco\s*[:\-]?\s*([^.;\n]{4,100}?)(?=\s+(?:numero\s+do\s+endereco|numero|complemento|cep|promotor|atendente)\b)/i,
    /((?:rua|avenida|av\.?|travessa|tv\.?|rodovia|estrada)\s+[^,.;\n]{4,100})/i,
    /\b([A-Z][A-Z\s]{5,80})\s+numero\s+do\s+endereco\b/i,
  ]);
  const number = firstMatch(q, [/(?:numero\s+do\s+endereco|numero|n[ºo.]*)\s*[:\-]?\s*(\d{1,6})/i]);
  const place = [city, estado].filter(Boolean).join(" ");
  const withCountry = (value) => [value, "Brasil"].filter(Boolean).join(" ");

  return uniqueValues([
    q,
    [street, number, bairro, city, estado].filter(Boolean).join(" "),
    [street, bairro, city, estado].filter(Boolean).join(" "),
    [street, city, estado].filter(Boolean).join(" "),
    [street, place].filter(Boolean).join(" "),
    [bairro, city, estado].filter(Boolean).join(" "),
    [cep, city, estado].filter(Boolean).join(" "),
    [city, estado].filter(Boolean).join(" "),
  ]).map(withCountry);
}
