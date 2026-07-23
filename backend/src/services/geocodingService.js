import { buildGeocodeQueries, normalizeGeoText } from "../utils/geoUtils.js";
import { stripDiacritics } from "../utils/stringUtils.js";

/**
 * Geocodificação confiável para laudo pericial (Brasil).
 *
 * Substitui a chamada crua ao Nominatim, que tinha duas falhas graves:
 *   1. a escada de fallback descartava a cidade e casava uma rua homônima em
 *      outro município — apresentando coordenada de cidade errada como se
 *      fosse a residência;
 *   2. nenhum sinal de precisão: um centroide de cidade era apresentado como
 *      endereço exato.
 *
 * Estratégia CEP-first:
 *   - Se o endereço tem CEP, resolve via AwesomeAPI (CEP → coordenada). O CEP é
 *     chave controlada e não "pula" de cidade — é a fonte mais confiável no
 *     Brasil, inclusive no interior.
 *   - Sem CEP (ou CEP sem resultado), cai no Nominatim COM guardas:
 *     countrycodes=br, e verificação de que a cidade retornada bate com a
 *     cidade pedida. Divergência → rejeita, nunca devolve coordenada de outra
 *     cidade.
 *
 * Todo resultado carrega `precision` ('street'|'postal'|'city'|'rooftop') e
 * `cityMatch`, para o §5 nunca tratar coordenada grosseira como exata.
 */

const FETCH_TIMEOUT_MS = 8_000;
const UA = "ForenseDoc/3.0 (Ronney Menezes Advocacia)";

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Comparação tolerante de nomes de cidade (sem acento, caixa, espaços extras).
function sameCity(a, b) {
  if (!a || !b) return false;
  const norm = (s) => stripDiacritics(String(s)).toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

export function extractCep(text) {
  const m = String(text || "").match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}${m[2]}` : null;
}

// Cidade e UF pedidas no endereço, para verificar o retorno do Nominatim.
function extractRequestedPlace(text) {
  const q = normalizeGeoText(text);
  const ufMatch = q.match(/\b(PI|MA|CE|PA|BA|PE|PB|RN|AL|SE|TO|GO|DF|MG|SP|RJ|ES|PR|SC|RS|MS|MT|RO|AC|AM|RR|AP)\b/i);
  const uf = ufMatch ? ufMatch[1].toUpperCase() : null;

  // Heurística p/ texto livre "Rua X, 50, Bairro, Cidade, UF": a cidade costuma
  // ser o penúltimo campo separado por vírgula (antes da UF).
  const parts = String(text || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let city = null;
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    // Se o último campo é a UF (2 letras), a cidade é o campo anterior.
    city = /^[A-Za-z]{2}$/.test(last) ? parts[parts.length - 2] : last;
  }
  // Também aceita "cidade: X" rotulado (endereço extraído do contrato).
  const labeled = q.match(/cidade\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:bairro|endereco|cep|estado)\b)/i);
  if (labeled) city = labeled[1];

  return { city: city || null, uf };
}

// ─────────────────────────────────────────────────────────────
// CEP-first (AwesomeAPI)
// ─────────────────────────────────────────────────────────────

async function geocodeByCep(cep) {
  const d = await fetchJson(`https://cep.awesomeapi.com.br/json/${cep}`);
  if (!d || d.status === 400 || !d.lat || !d.lng) return null;

  const lat = parseFloat(d.lat);
  const lon = parseFloat(d.lng);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  // Rua/bairro presentes = precisão de rua; ausentes (CEP geral de cidade
  // pequena) = precisão de cidade — honesto para o interior.
  const hasStreet = Boolean(d.address_name || d.district);
  const displayParts = [d.address, d.district, d.city, d.state].filter(Boolean);

  return {
    lat,
    lon,
    display: displayParts.join(", ") || `CEP ${cep}`,
    precision: hasStreet ? "street" : "city",
    source: "awesomeapi-cep",
    matchedCity: d.city || null,
    matchedUf: d.state || null,
    cityMatch: true, // CEP é autoritativo
    query: `CEP ${cep}`,
  };
}

// ─────────────────────────────────────────────────────────────
// Nominatim com guardas
// ─────────────────────────────────────────────────────────────

// Traduz a resposta do Nominatim em nível de precisão. Baseia-se primeiro no
// número da casa (sinal mais forte de precisão exata), depois na rua.
function nominatimPrecision(item) {
  const a = item.address || {};
  const at = item.addresstype;
  const cls = item.class;
  if (a.house_number || at === "building" || at === "house" || cls === "building" || item.type === "house") {
    return "rooftop";
  }
  if (a.road || at === "road" || cls === "highway") return "street";
  if (at === "postcode" || item.type === "postcode") return "postal";
  return "city";
}

function nominatimCity(item) {
  const a = item.address || {};
  return a.city || a.town || a.village || a.municipality || a.county || null;
}

async function geocodeByNominatim(rawQuery) {
  const requested = extractRequestedPlace(rawQuery);

  for (const query of buildGeocodeQueries(rawQuery)) {
    // countrycodes=br é filtro rígido; addressdetails=1 traz a cidade casada
    // para verificação; limit=5 para escolher o melhor que bate a cidade.
    const url =
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
      `&format=json&addressdetails=1&countrycodes=br&limit=5&accept-language=pt-BR`;
    const results = await fetchJson(url);
    if (!Array.isArray(results) || results.length === 0) continue;

    // Se sabemos a cidade pedida, exige que o resultado bata com ela — é o que
    // impede o caso "rua homônima em outro município".
    let chosen = null;
    if (requested.city) {
      chosen = results.find((item) => sameCity(nominatimCity(item), requested.city));
      if (!chosen) continue; // nenhum resultado desta query bate a cidade; tenta a próxima
    } else {
      chosen = results[0];
    }

    return {
      lat: parseFloat(chosen.lat),
      lon: parseFloat(chosen.lon),
      display: chosen.display_name,
      precision: nominatimPrecision(chosen),
      source: "nominatim",
      matchedCity: nominatimCity(chosen),
      matchedUf: chosen.address?.["ISO3166-2-lvl4"]?.replace("BR-", "") || null,
      cityMatch: requested.city ? true : null,
      query,
    };
  }
  return null;
}

/**
 * Geocodifica um endereço com a estratégia CEP-first + Nominatim verificado.
 * Devolve null se nada confiável for encontrado (melhor nulo que coordenada
 * errada — o §5 sinaliza "não geocodificado" em vez de mentir uma distância).
 */
export async function geocodeAddress(rawQuery) {
  const text = String(rawQuery || "").trim();
  if (!text) return null;

  const cep = extractCep(text);
  if (cep) {
    const byCep = await geocodeByCep(cep);
    if (byCep) return byCep;
  }

  return geocodeByNominatim(text);
}
