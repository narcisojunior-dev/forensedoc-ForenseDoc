import { buildGeocodeQueries, normalizeGeoText } from "../utils/geoUtils.js";
import { stripDiacritics } from "../utils/stringUtils.js";
import { buildSearchUrl, buildReverseUrl, NOMINATIM_UA } from "./nominatimClient.js";
import { geocodeResultMatches, isWholeMunicipalityCep } from "../engine/geocodeCascade.js";
import { cached, TTL } from "../utils/externalCache.js";

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

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "User-Agent": NOMINATIM_UA }, signal: controller.signal });
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
  // O ponto de milhar aparece com frequência no endereço digitado ("69.435-000")
  // e, sem ele no padrão, o CEP não era reconhecido e a residência ficava sem
  // coordenada de referência.
  const m = String(text || "").match(/\b(\d{2}\.?\d{3})-?(\d{3})\b/);
  return m ? `${m[1].replace(".", "")}${m[2]}` : null;
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
    const url = buildSearchUrl(query, { addressdetails: 1, countrycodes: "br", limit: 5 });
    const results = await fetchJson(url);
    if (!Array.isArray(results) || results.length === 0) continue;

    // Se sabemos a cidade pedida, exige que o resultado bata com ela — é o que
    // impede o caso "rua homônima em outro município".
    //
    // Sem cidade reconhecível, o resultado antes era aceito às cegas. O motor
    // pericial documentou o custo: "Rua R, zona rural, boa hora/Pi." foi
    // geocodificado a 369 km do lugar. Agora o resultado só passa se UF, CEP ou
    // candidato de município do texto aparecerem no endereço devolvido.
    let chosen = null;
    if (requested.city) {
      chosen = results.find((item) => sameCity(nominatimCity(item), requested.city));
      if (!chosen) continue; // nenhum resultado desta query bate a cidade; tenta a próxima
    } else {
      chosen = results.find((item) => geocodeResultMatches(rawQuery, item.display_name));
      if (!chosen) continue;
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

// ─────────────────────────────────────────────────────────────
// ViaCEP (Correios) → município/UF oficiais → Nominatim estruturado
// ─────────────────────────────────────────────────────────────

/**
 * Consulta o CEP na base dos Correios via ViaCEP.
 *
 * Segunda via do CEP-first, portada do motor pericial: quando a AwesomeAPI não
 * tem coordenada para o CEP (comum em CEP genérico de município do interior), o
 * ViaCEP ainda devolve município e UF oficiais, e isso basta para uma
 * geocodificação estruturada que não "pula" de cidade.
 */
export async function viaCepLookup(cep) {
  const digits = String(cep || "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  return cached("viacep", digits, TTL.geocode, async () => {
    const d = await fetchJson(`https://viacep.com.br/ws/${digits}/json/`);
    if (!d || d.erro) return null;
    return { logradouro: d.logradouro || null, bairro: d.bairro || null, municipio: d.localidade || null, uf: d.uf || null };
  });
}

async function geocodeByViaCep(cep) {
  const via = await viaCepLookup(cep);
  if (!via?.municipio || !via?.uf) return null;
  const url = buildSearchUrl(`${via.municipio}, ${via.uf}, Brasil`, { addressdetails: 1, countrycodes: "br", limit: 5 });
  const results = await fetchJson(url);
  if (!Array.isArray(results) || !results.length) return null;
  const chosen = results.find((item) => sameCity(nominatimCity(item), via.municipio)) || null;
  if (!chosen) return null;
  return {
    lat: parseFloat(chosen.lat),
    lon: parseFloat(chosen.lon),
    display: chosen.display_name,
    // O ponto é o centro do município: o laudo não pode apresentá-lo como rua.
    precision: "city",
    precisionNote: isWholeMunicipalityCep(cep)
      ? "município (CEP genérico, sem logradouro)"
      : "centro do município (logradouro não geocodificado separadamente)",
    source: "viacep+nominatim",
    matchedCity: via.municipio,
    matchedUf: via.uf,
    cityMatch: true,
    query: `${via.municipio}/${via.uf} (CEP ${cep} via ViaCEP)`,
  };
}

/**
 * Município e UF de uma coordenada (geocodificação reversa).
 *
 * Um GPS a poucas dezenas de quilômetros da residência ainda pode cair em outro
 * município, e para a diligência (correspondente bancário, deslocamento) isso
 * pesa mais que a distância bruta.
 */
export async function reverseGeocode(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  // Arredondado a ~100 m: suficiente para o município e evita guardar a
  // coordenada exata do ato como chave de cache.
  const chave = `${la.toFixed(3)},${lo.toFixed(3)}`;
  return cached("reverse-geocode", chave, TTL.geocode, async () => {
    const d = await fetchJson(buildReverseUrl(la, lo, { zoom: 10 }));
    if (!d || d.error || !d.address) return null;
    return {
      municipio: d.address.municipality || d.address.city || d.address.town || d.address.village || null,
      uf: d.address["ISO3166-2-lvl4"]?.replace("BR-", "") || null,
      display: d.display_name || null,
    };
  });
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
    const byViaCep = await geocodeByViaCep(cep);
    if (byViaCep) return byViaCep;
  }

  return geocodeByNominatim(text);
}
