import { getIpInfo } from "../services/apiService.js";
import { geocodeAddress } from "../services/geocodingService.js";

export async function geocode(req, res) {
  try {
    const q = req.query.q;
    const result = await geocodeAddress(q);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export async function ipLocation(req, res) {
  try {
    const ip = req.params.ip;
    const result = await getIpInfo(ip);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
