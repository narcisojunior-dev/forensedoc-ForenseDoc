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
import { cachedBuffer, TTL } from "../utils/externalCache.js";

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

  const { width = 780, height = 460, line = true, lineColor = null } = opts;

  // Marcadores: um por ponto, cor própria e rótulo curto.
  const markers = valid
    .map((p) => {
      const color = encodeURIComponent(p.color || "#3b82f6");
      const parts = [`lonlat:${p.lon},${p.lat}`, "type:material", `color:${color}`, "size:medium"];
      if (p.label) parts.push(`text:${encodeURIComponent(p.label)}`);
      return parts.join(";");
    })
    .join("|");

  // Linha da distância entre os dois pontos do confronto. A cor acompanha o
  // segundo ponto (o que está sendo confrontado com a referência), para que a
  // legenda do laudo e o traço no mapa concordem sem precisar de explicação.
  let geometry = "";
  if (line && valid.length >= 2) {
    const a = valid[0];
    const b = valid[1];
    const cor = encodeURIComponent(lineColor || b.color || "#dc2626");
    geometry =
      `&geometry=polyline:${a.lon},${a.lat},${b.lon},${b.lat};` +
      `linecolor:${cor};linewidth:3;lineopacity:0.9`;
  }

  const url =
    `${BASE}?style=osm-bright&width=${width}&height=${height}&scaleFactor=2` +
    `&area=${encodeURIComponent(boundingArea(valid))}` +
    `&marker=${markers}${geometry}&apiKey=${key}`;

  /*
   * A imagem era buscada a CADA geração de PDF. O mesmo laudo baixado três vezes
   * gastava seis créditos da cota diária do Geoapify (3.000 por dia, 2 por
   * laudo), e o download repetido é comum: o advogado gera, confere, e gera de
   * novo para anexar ao processo.
   *
   * A chave de cache é a URL SEM a chave de API. Incluí-la faria a rotação da
   * credencial invalidar todo o cache de uma vez, e ainda gravaria o segredo
   * dentro do nome da chave no Redis.
   */
  const chaveCache = url.replace(`&apiKey=${key}`, "");

  return cachedBuffer("staticmap", chaveCache, TTL.staticMap, async () => {
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
  });
}

/*
 * ─── Dois mapas, dois confrontos ─────────────────────────────────────────────
 *
 * Antes havia um único mapa com os três pontos (residência, GPS declarado e
 * origem do IP) e uma linha ligando apenas os dois primeiros. Isso confundia
 * duas perguntas periciais distintas num só quadro:
 *
 *   1. A CONEXÃO partiu de onde o cliente mora?  (residência × IP)
 *   2. O DOCUMENTO afirma que o ato ocorreu onde o cliente mora?
 *      (residência × GPS declarado)
 *
 * As duas têm naturezas diferentes e não se somam. A primeira compara contra um
 * dado de precisão de operadora — dezenas de quilômetros de margem. A segunda
 * compara duas coordenadas de precisão métrica, onde uma divergência de poucos
 * quilômetros já é significativa. Sobrepostas no mesmo enquadramento, a escala
 * do confronto de IP (centenas de km) achatava o outro até a irrelevância
 * visual: os pontos R e A viravam um só pixel.
 *
 * Cada função abaixo devolve o PAR de um confronto, e `fetchStaticMap` liga os
 * dois primeiros pontos com a linha da distância.
 */

/** Primeiro IP geolocalizado — dossiês repetem o mesmo endereço em vários eventos. */
function primeiroIpGeolocalizado(result) {
  return (result?.ipAnalysis || []).find(
    (ip) => Number.isFinite(ip.geo?.lat) && Number.isFinite(ip.geo?.lon)
  );
}

function pontoResidencia(result) {
  const home = result?.home?.geo;
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return null;
  return { lat: home.lat, lon: home.lon, color: "#2563eb", label: "R" };
}

/**
 * Mapa 1 — origem da conexão (I) × residência informada (R).
 * Responde: a conexão que gerou a assinatura partiu da região onde o cliente mora?
 */
export function mapPointsIpVsHome(result) {
  const r = pontoResidencia(result);
  const ip = primeiroIpGeolocalizado(result);
  if (!r || !ip) return [];
  return [r, { lat: ip.geo.lat, lon: ip.geo.lon, color: "#dc2626", label: "I" }];
}

/**
 * Mapa 2 — residência informada (R) × geolocalização declarada no documento (A).
 * Responde: o documento afirma que o ato ocorreu onde o cliente mora?
 */
export function mapPointsHomeVsDeclared(result) {
  const r = pontoResidencia(result);
  const cg = result?.contractGeo;
  if (!r || !cg || !Number.isFinite(cg.lat) || !Number.isFinite(cg.lon)) return [];
  return [r, { lat: cg.lat, lon: cg.lon, color: "#f59e0b", label: "A" }];
}
