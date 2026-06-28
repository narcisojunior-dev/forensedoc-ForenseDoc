export const API_BASE = import.meta.env.VITE_API_BASE || "";

export async function geolocateIP(ip) {
  try {
    const r = await fetch(`${API_BASE}/api/ip/${ip}`);
    const d = await r.json();
    if (!d || d.error) return null;
    return d;
  } catch {
    return null;
  }
}

export async function geocodeAddress(address) {
  try {
    const r = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(address)}`);
    const d = await r.json();
    if (d && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
      return { lat: d.lat, lon: d.lon, display: d.display || address, query: d.query || address };
    }
  } catch {}
  return null;
}

export async function checkBackendReady() {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    const d = await r.json();
    if (!r.ok || !d?.ok) {
      return { ok: false, message: "O backend respondeu, mas não está saudável. Reinicie o servidor backend e tente novamente." };
    }
    return { ok: true, warning: "" };
  } catch {
    return { ok: false, message: "O backend não está respondendo. Inicie o backend em http://localhost:8787 antes de analisar o contrato." };
  }
}
