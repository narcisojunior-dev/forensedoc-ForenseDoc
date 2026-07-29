import axios from "axios";

// Mesma convenção de utils/api.js: VITE_API_BASE é o host "nu" (sem /api),
// ex. https://forensedoc-backend.up.railway.app — em dev, fica vazio e o
// proxy do Vite encaminha /api para o backend local.
const baseURL = (import.meta.env.VITE_API_BASE || "") + "/api";

export const api = axios.create({
  baseURL,
  withCredentials: true, // Para enviar e receber cookies (Refresh Token)
});

// Interceptor para injetar o Access Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Renovação serializada do access token.
 *
 * O backend rotaciona o refresh token a cada uso e trata a reutilização de um
 * token já rotacionado como roubo — revogando TODAS as sessões do usuário
 * (authController.refresh). Sem serializar, duas requisições que expiram ao
 * mesmo tempo (o dashboard dispara transações e estatísticas em paralelo)
 * mandariam dois POST /auth/refresh com o mesmo cookie: o segundo chegaria com
 * o token já revogado e derrubaria o login legítimo.
 *
 * Por isso o refresh vira uma promise única compartilhada: a primeira 401
 * dispara a renovação, as demais aguardam o mesmo resultado.
 */
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${baseURL}/auth/refresh`, {}, { withCredentials: true })
      .then(({ data }) => {
        localStorage.setItem("accessToken", data.accessToken);
        return data.accessToken;
      })
      .finally(() => {
        // Zerado no fim (sucesso ou falha) para que uma expiração futura possa
        // renovar de novo, em vez de reusar uma promise já resolvida.
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Interceptor para tratar expiração do Access Token (401)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Se erro for 401 e for erro de token expirado (verificamos a flag _retry para evitar loop infinito)
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Ignora se for a rota de login ou refresh (para não loopear)
      const url = originalRequest.url || "";
      if (url.includes("/auth/login") || url.includes("/auth/refresh")) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh token falhou (inválido ou expirado), deslogar o usuário
        localStorage.removeItem("accessToken");
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
