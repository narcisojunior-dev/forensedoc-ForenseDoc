/**
 * Imagem de mapa estático real para o §5 do laudo (PDF).
 *
 * Usa a Static Maps API da Geoapify (tier grátis, sem cartão). O servidor busca
 * o PNG a partir das coordenadas já persistidas — geração determinística e
 * reprodutível: o mesmo laudo sempre produz o mesmo mapa.
 *
 * Degradação graciosa: sem GEOAPIFY_KEY, ou se a busca falhar, devolve null e o
 * PDF sai sem o mapa (o §5 continua com a tabela de coordenadas e distâncias).
 * O mapa é um reforço visual, nunca um requisito para o laudo existir.
 */

// O módulo lê GEOAPIFY_KEY do ambiente. `server.js` e `worker.js` já carregam o
// dotenv antes de importá-lo, mas depender disso deixava o mapa silenciosamente
// ausente em qualquer entrada que não passe por eles (script, teste, CLI) — e a
// ausência do mapa não gera erro, só um laudo sem a peça visual. Mesma proteção
// que utils/jwt.js e utils/mailer.js já adotam.
import "dotenv/config";

const FETCH_TIMEOUT_MS = 10_000;
const BASE = "https://maps.geoapify.com/v1/staticmap";

// Área visível (bounding box) que enquadra todos os pontos, com folga.
function boundingArea(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);

  // Span mínimo para pontos muito próximos não gerarem zoom absurdo.
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lonSpan = Math.max(maxLon - minLon, 0.01);
  const padLat = latSpan * 0.25;
  const padLon = lonSpan * 0.25;

  minLat -= padLat;
  maxLat += padLat;
  minLon -= padLon;
  maxLon += padLon;

  // Geoapify: rect:lon1,lat1,lon2,lat2
  return `rect:${minLon.toFixed(6)},${minLat.toFixed(6)},${maxLon.toFixed(6)},${maxLat.toFixed(6)}`;
}

/**
 * Busca o mapa estático dos pontos informados.
 *
 * @param {Array<{lat:number, lon:number, color:string, label?:string}>} points
 * @param {{width?:number, height?:number, line?:boolean}} [opts]
 * @returns {Promise<Buffer|null>} PNG do mapa, ou null se indisponível
 */
export async function fetchStaticMap(points, opts = {}) {
  const key = process.env.GEOAPIFY_KEY;
  if (!key) return null;

  const valid = (points || []).filter(
    (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
  );
  if (valid.length === 0) return null;

  const { width = 780, height = 460, line = true } = opts;

  // Marcadores: um por ponto, cor própria e rótulo curto.
  const markers = valid
    .map((p) => {
      const color = encodeURIComponent(p.color || "#3b82f6");
      const parts = [`lonlat:${p.lon},${p.lat}`, "type:material", `color:${color}`, "size:medium"];
      if (p.label) parts.push(`text:${encodeURIComponent(p.label)}`);
      return parts.join(";");
    })
    .join("|");

  // Linha entre os dois primeiros pontos (residência ↔ assinatura declarada).
  let geometry = "";
  if (line && valid.length >= 2) {
    const a = valid[0];
    const b = valid[1];
    geometry =
      `&geometry=polyline:${a.lon},${a.lat},${b.lon},${b.lat};` +
      `linecolor:%23f06363;linewidth:3;lineopacity:0.9`;
  }

  const url =
    `${BASE}?style=osm-bright&width=${width}&height=${height}&scaleFactor=2` +
    `&area=${encodeURIComponent(boundingArea(valid))}` +
    `&marker=${markers}${geometry}&apiKey=${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.error(`[StaticMap] Geoapify respondeu ${res.status}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error("[StaticMap] Falha ao buscar mapa:", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Monta os pontos do §5 (residência + assinatura declarada) para o mapa.
/**
 * Pontos do mapa do § 5: residência (R), assinatura declarada (A) e origem do
 * IP (I).
 *
 * O ponto do IP passou a integrar o mapa porque o confronto que mais interessa
 * ao laudo é justamente entre a ORIGEM DA CONEXÃO e o local informado — e ele
 * só existia como número em quilômetros, no meio do texto. Ver os três pontos
 * enquadrados juntos mostra de imediato se o ato partiu da região informada.
 *
 * Só o primeiro IP geolocalizado entra. Documentos de trilha de auditoria
 * costumam repetir o mesmo endereço em vários eventos, e plotar todos
 * empilharia marcadores sobre o mesmo ponto sem acrescentar informação.
 */
export function signatureMapPoints(result) {
  const points = [];
  const home = result?.home?.geo;
  const cg = result?.contractGeo;

  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    points.push({ lat: home.lat, lon: home.lon, color: "#2563eb", label: "R" });
  }
  if (cg && Number.isFinite(cg.lat) && Number.isFinite(cg.lon)) {
    points.push({ lat: cg.lat, lon: cg.lon, color: "#f59e0b", label: "A" });
  }

  const ipGeo = (result?.ipAnalysis || []).find(
    (ip) => Number.isFinite(ip.geo?.lat) && Number.isFinite(ip.geo?.lon)
  );
  if (ipGeo) {
    points.push({ lat: ipGeo.geo.lat, lon: ipGeo.geo.lon, color: "#dc2626", label: "I" });
  }

  return points;
}
