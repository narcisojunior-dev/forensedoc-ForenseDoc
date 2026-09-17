function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return (match[1] || match[0]).replace(/\s+/g, " ").trim();
  }
  return null;
}

const BRASIL_BBOX = { minLat: -34.0, maxLat: 5.5, minLon: -74.5, maxLon: -34.0 };
const GEO_LABEL_RE = /(?:geolocaliza|geolocalização|latitude|longitude|\blat\b|\blng\b|\blon\b|coordenada|coordenadas|GPS|posição|localização do aceite|latitude e longitude)/i;

function sanitizeNumericNoise(value) {
  return String(value || "")
    .replace(/\b::ffff:(?:\d{1,3}\.){3}\d{1,3}\b/gi, " [IP] ")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, " [IP] ")
    .replace(/\b(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}\b/g, " [IP] ")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, " [CNPJ] ")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, " [CPF] ")
    .replace(/\b\d{5}-?\d{3}\b/g, " [CEP] ")
    .replace(/\b\d+\.\d+\.\d+(?:\.\d+)?\b/g, " [VERSAO] ")
    .replace(/R\$\s?[\d.]+,\d{2}/g, " [VALOR] ");
}

function hasSemanticLabelBefore(source, index) {
  const window = source.slice(Math.max(0, index - 80), index + 24);
  return GEO_LABEL_RE.test(window);
}

function hasDecimalPrecision(raw) {
  const match = String(raw || "").match(/[.,](\d+)/);
  return Boolean(match && match[1].length >= 4);
}

function insideBrazil(lat, lon) {
  return lat >= BRASIL_BBOX.minLat && lat <= BRASIL_BBOX.maxLat && lon >= BRASIL_BBOX.minLon && lon <= BRASIL_BBOX.maxLon;
}

export function parseCoordinate(raw, axis) {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).replace(/[−–—]/g, "-").trim().toUpperCase();
  const hemisphere = value.match(/[NSEWOL]\s*$/)?.[0]?.trim();
  const dms = value.match(/([+\-]?\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’]?\s*(\d{1,2}(?:[.,]\d+)?)?/);
  let coordinate;
  if (dms) {
    coordinate = Math.abs(Number(dms[1])) + Number(dms[2] || 0) / 60 + Number(String(dms[3] || 0).replace(",", ".")) / 3600;
    if (Number(dms[1]) < 0) coordinate *= -1;
  } else {
    const decimal = value.match(/[+\-]?\s*\d{1,3}(?:[.,]\d+)?/);
    if (!decimal) return null;
    coordinate = Number(decimal[0].replace(/\s/g, "").replace(",", "."));
  }
  if (hemisphere && /[SWO]/.test(hemisphere)) coordinate = -Math.abs(coordinate);
  if (hemisphere && /[NEL]/.test(hemisphere)) coordinate = Math.abs(coordinate);
  const limit = axis === "lat" ? 90 : 180;
  return Number.isFinite(coordinate) && Math.abs(coordinate) <= limit ? coordinate : null;
}

export function extractCoordinates(text) {
  const original = String(text || "").replace(/%2C/ig, ",").replace(/%20/ig, " ");
  const source = sanitizeNumericNoise(original);
  const dmsLat = firstMatch(source, [/\b(?:latitude|lat)\s*[:=]?\s*([+\-−]?\d{1,2}\s*[°º]\s*\d{1,2}\s*['’]?\s*\d{1,2}(?:[.,]\d+)?\s*["”]?\s*[NS]?)/i]);
  const dmsLon = firstMatch(source, [/\b(?:longitude|lon|lng|long)\s*[:=]?\s*([+\-−]?\d{1,3}\s*[°º]\s*\d{1,2}\s*['’]?\s*\d{1,2}(?:[.,]\d+)?\s*["”]?\s*[EWOL]?)/i]);
  const decimalLat = firstMatch(source, [/\b(?:latitude|lat)\s*[:=]?\s*([+\-−]?\s*\d{1,2}[.,]\d{4,}\s*[NS]?)/i]);
  const decimalLon = firstMatch(source, [/\b(?:longitude|lon|lng|long)\s*[:=]?\s*([+\-−]?\s*\d{1,3}[.,]\d{4,}\s*[EWOL]?)/i]);
  let lat = parseCoordinate(dmsLat || decimalLat, "lat");
  let lon = parseCoordinate(dmsLon || decimalLon, "lon");

  if (lat === null || lon === null) {
    const pair = source.match(/(?:@|[?&](?:q|query|ll)=|latitude\s+e\s+longitude\s*[:=]?)?\s*([+\-−]?\d{1,2}[.,]\d{4,})\s*(?:[,;\/]|\s+)\s*([+\-−]?\d{1,3}[.,]\d{4,})/i);
    if (pair) {
      const isMapUrl = /(?:@|[?&](?:q|query|ll)=)/i.test(source.slice(Math.max(0, pair.index - 16), pair.index + 8));
      if ((isMapUrl || hasSemanticLabelBefore(source, pair.index)) && hasDecimalPrecision(pair[1]) && hasDecimalPrecision(pair[2])) {
        lat = parseCoordinate(pair[1], "lat");
        lon = parseCoordinate(pair[2], "lon");
      }
    }
  }
  return lat !== null && lon !== null && insideBrazil(lat, lon) ? { lat, lon } : null;
}
