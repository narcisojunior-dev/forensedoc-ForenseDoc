import { buildGeocodeQueries } from "../utils/geoUtils.js";

export async function geocodeAddress(q) {
  const queryText = (q || "").toString().trim();
  if (!queryText) return null;
  for (const query of buildGeocodeQueries(queryText)) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=pt-BR`;
    const r = await fetch(url, { headers: { "User-Agent": "ForenseDoc/2.2 (Ronney Menezes Advocacia)" } });
    const d = await r.json();
    if (Array.isArray(d) && d[0]) {
      return {
        lat: parseFloat(d[0].lat),
        lon: parseFloat(d[0].lon),
        display: d[0].display_name,
        query,
      };
    }
  }
  return null;
}

export async function getIpInfo(ip) {
  const r = await fetch(`https://ipapi.co/${ip}/json/`);
  const d = await r.json();
  if (d.error) return null;
  return {
    ip: d.ip,
    city: d.city,
    region: d.region,
    country: d.country_name,
    lat: d.latitude,
    lon: d.longitude,
    isp: d.org || d.asn,
    timezone: d.timezone,
    currency: d.currency,
  };
}
