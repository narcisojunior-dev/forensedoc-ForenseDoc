import { randomUUID } from "node:crypto";
import { buildGeocodeQueries } from "../utils/geoUtils.js";
import { cached, TTL } from "../utils/externalCache.js";
import { buildSearchUrl, NOMINATIM_UA } from "./nominatimClient.js";

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Geocodifica um endereço, com cache.
 *
 * A chave é o texto normalizado, não cada variação que `buildGeocodeQueries`
 * gera: o mesmo endereço consultado de novo tem que acertar o cache antes de
 * chegar ao Nominatim, cuja política de uso proíbe consulta automatizada pesada
 * e bloqueia por IP do servidor.
 *
 * Repetição é alta no domínio: os documentos de um mesmo cliente trazem o
 * endereço da residência do contratante repetidas vezes.
 */
export async function geocodeAddress(q) {
  const queryText = (q || "").toString().trim();
  if (!queryText) return null;
  return cached("geocode", queryText.toLowerCase(), TTL.geocode, () =>
    geocodeAddressSemCache(queryText)
  );
}

async function geocodeAddressSemCache(queryText) {
  for (const query of buildGeocodeQueries(queryText)) {
    const url = buildSearchUrl(query, { limit: 1 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": NOMINATIM_UA },
        signal: controller.signal,
      });
      const d = await r.json();
      if (Array.isArray(d) && d[0]) {
        return {
          lat: parseFloat(d[0].lat),
          lon: parseFloat(d[0].lon),
          display: d[0].display_name,
          query,
        };
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.warn(`[API] Nominatim timeout para query: ${query}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Provedores de geolocalização por IP, em ordem de tentativa.
 *
 * Existir mais de um não é redundância: o ipapi.co tem cota gratuita baixa e,
 * quando ela esgota, responde `{"error": true, "reason": "RateLimited"}` com
 * HTTP 200. O código antigo tratava isso como "IP sem localização" e o § 6 do
 * laudo saía vazio — sem nenhum indício de que a falha era de cota, não do
 * documento. Num laudo pericial, ausência de dado e falha de consulta são coisas
 * diferentes e não podem se confundir.
 *
 * Ambos aceitam IPv4 e IPv6 e dispensam chave.
 */
const PROVEDORES_GEOIP = [
  {
    nome: "ipapi.co",
    url: (ip) => `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
    normalizar: (d) =>
      d.error || d.latitude == null
        ? null
        : {
            city: d.city,
            region: d.region,
            // ipapi.co devolve o país em inglês; o laudo é em português.
            country: d.country_name === "Brazil" ? "Brasil" : d.country_name,
            lat: Number(d.latitude),
            lon: Number(d.longitude),
            isp: d.org || d.asn,
            timezone: d.timezone,
          },
  },
  {
    nome: "ipwho.is",
    url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}`,
    normalizar: (d) =>
      d.success === false || d.latitude == null
        ? null
        : {
            city: d.city,
            region: d.region,
            country: d.country,
            lat: Number(d.latitude),
            lon: Number(d.longitude),
            isp: d.connection?.isp || d.connection?.org,
            timezone: d.timezone?.id,
          },
  },
];

/**
 * @returns {Promise<object|null>} dados de localização, ou `null` se NENHUM
 *   provedor respondeu. O chamador distingue os casos pelo campo `source`.
 */
export async function getIpInfo(ip) {
  // Dossiês de trilha repetem o mesmo endereço em vários eventos, e clientes de
  // uma mesma operadora caem em blocos próximos. Sem cache, cada repetição
  // consome uma consulta da cota diária.
  return cached("geoip-v2", ip, TTL.geoip, () => getIpInfoSemCache(ip));
}

async function getIpInfoSemCache(ip) {
  for (const provedor of PROVEDORES_GEOIP) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(provedor.url(ip), {
        signal: controller.signal,
        headers: { "User-Agent": "ForenseDoc/3.0 (laudo pericial)" },
      });
      if (!r.ok) continue;

      const normalizado = provedor.normalizar(await r.json());
      if (normalizado) {
        // `source` entra no laudo: a origem do dado é parte da cadeia de
        // custódia, e dois provedores podem divergir entre si.
        return { ip, ...normalizado, source: provedor.nome, queriedAt: new Date().toISOString(), queryId: randomUUID(), granularity: "estimativa de rede; margem de erro não fornecida" };
      }
    } catch (err) {
      const motivo = err.name === "AbortError" ? "timeout" : err.message;
      console.warn(`[API] ${provedor.nome} indisponível para ${ip}: ${motivo}`);
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn(`[API] Nenhum provedor de geolocalização respondeu para ${ip}`);
  return null;
}
