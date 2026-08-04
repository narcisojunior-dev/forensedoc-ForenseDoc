import { api } from "../lib/axios.js";

export const API_BASE = import.meta.env.VITE_API_BASE || "";

/**
 * Helpers da tela legada (/v2).
 *
 * Antes usavam `fetch` puro, sem o header Authorization — e as rotas /api/ip e
 * /api/geocode passaram a exigir autenticação, então toda chamada respondia 401
 * e o resultado virava `null` silenciosamente. Passando pelo client `api`, o
 * interceptor injeta o token e renova a sessão quando ele expira.
 */
export async function geolocateIP(ip) {
  try {
    const { data } = await api.get(`/ip/${encodeURIComponent(ip)}`);
    if (!data || data.error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function geocodeAddress(address) {
  try {
    const { data } = await api.get("/geocode", { params: { q: address } });
    if (data && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
      return {
        lat: data.lat,
        lon: data.lon,
        display: data.display || address,
        query: data.query || address,
      };
    }
  } catch {
    /* indisponível: a tela segue sem a coordenada */
  }
  return null;
}

/**
 * O healthcheck fica em /health, FORA do prefixo /api (ver server.js) — apontar
 * para /api/health devolvia o 404 do roteador e a função reportava o backend
 * como fora do ar mesmo com ele rodando. A resposta traz `{ status: "ok" }`,
 * não `{ ok: true }`, que era o campo verificado antes.
 */
export async function checkBackendReady() {
  try {
    const r = await fetch(`${API_BASE}/health`);
    const d = await r.json();
    if (!r.ok || d?.status !== "ok") {
      return {
        ok: false,
        message:
          "O backend respondeu, mas não está saudável. Reinicie o servidor backend e tente novamente.",
      };
    }
    return { ok: true, warning: "" };
  } catch {
    return {
      ok: false,
      message:
        "O backend não está respondendo. Inicie o backend em http://localhost:8787 antes de analisar o contrato.",
    };
  }
}
