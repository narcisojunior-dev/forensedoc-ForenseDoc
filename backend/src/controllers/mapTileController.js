import { cachedBuffer } from "../utils/externalCache.js";

/**
 * Blocos cartográficos do mapa do laudo (motor pericial v2).
 *
 * O laudo desenha a cartografia real em projeção Web Mercator, com os pontos
 * posicionados pelas coordenadas, e captura tudo em imagem no PDF. Os blocos
 * passam pelo backend por dois motivos: a captura em canvas exige imagem da
 * mesma origem, e a chave do provedor não pode ir para o navegador.
 *
 * A rota é pública porque `<img>` não envia o token de acesso. O conteúdo é
 * cartografia genérica (nenhum dado do laudo trafega), o limitador global por
 * IP continua valendo e os parâmetros são validados antes de qualquer consulta.
 *
 * Provedor: Geoapify quando `GEOAPIFY_KEY` está configurada, que é o uso
 * comercial permitido; sem chave, o servidor de blocos do OpenStreetMap, cuja
 * política proíbe uso pesado e serve só para desenvolvimento.
 */
const TTL_BLOCO = Number(process.env.CACHE_TTL_MAP_TILE) || 7 * 24 * 3600;
const FETCH_TIMEOUT_MS = 8_000;

function urlDoBloco(z, x, y) {
  const chave = process.env.GEOAPIFY_KEY;
  if (chave) return `https://maps.geoapify.com/v1/tile/osm-carto/${z}/${x}/${y}.png?apiKey=${encodeURIComponent(chave)}`;
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

async function buscarBloco(z, x, y) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(urlDoBloco(z, x, y), {
      signal: controller.signal,
      headers: { "User-Agent": process.env.NOMINATIM_USER_AGENT || "ForenseDoc/3.0 (laudo pericial)" },
    });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parametrosDoBloco(params) {
  const z = Number(params.z);
  const x = Number(params.x);
  const y = Number(params.y);
  const limite = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 18 || x < 0 || y < 0 || x >= limite || y >= limite) {
    return null;
  }
  return { z, x, y };
}

export async function getMapTile(req, res) {
  const p = parametrosDoBloco(req.params);
  if (!p) return res.status(400).json({ error: "Bloco cartográfico inválido." });
  try {
    const bloco = await cachedBuffer("map-tile", `${p.z}/${p.x}/${p.y}`, TTL_BLOCO, () => buscarBloco(p.z, p.x, p.y));
    if (!bloco) return res.status(502).json({ error: "Mapa temporariamente indisponível." });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(bloco);
  } catch (err) {
    console.error("[MapTile] Falha ao servir bloco:", err.message);
    return res.status(502).json({ error: "Mapa temporariamente indisponível." });
  }
}
