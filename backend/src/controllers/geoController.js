import { isIP } from "node:net";
import { getIpInfo } from "../services/apiService.js";
import { geocodeAddress } from "../services/geocodingService.js";

export async function geocode(req, res) {
  try {
    // Coagido a string: `?q[a]=b` chega como objeto pelo qs, e o serviço monta
    // a URL do Nominatim por interpolação.
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const result = await geocodeAddress(q);
    return res.json(result);
  } catch (e) {
    console.error("[Geo] Erro ao geocodificar:", e.message);
    return res.status(502).json({ error: "Serviço de geocodificação indisponível." });
  }
}

export async function ipLocation(req, res) {
  try {
    const ip = req.params.ip;
    // O parâmetro é interpolado cru na URL da ipapi.co. Sem validar, um `%23`
    // ou `%3F` no path permite manipular a requisição de saída — e um valor
    // que nem é IP só gasta uma chamada externa para nada.
    if (!isIP(ip)) {
      return res.status(400).json({ error: "Endereço IP inválido." });
    }
    const result = await getIpInfo(ip);
    return res.json(result);
  } catch (e) {
    console.error("[Geo] Erro ao localizar IP:", e.message);
    return res.status(502).json({ error: "Serviço de geolocalização indisponível." });
  }
}
