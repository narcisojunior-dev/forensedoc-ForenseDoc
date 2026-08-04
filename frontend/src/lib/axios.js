import axios from "axios";

// Mesma convenção de utils/api.js: VITE_API_BASE é o host "nu" (sem /api),
// ex. https://forensedoc-backend.up.railway.app — em dev, fica vazio e o
// proxy do Vite encaminha /api para o backend local.
const baseURL = (import.meta.env.VITE_API_BASE || "") + "/api";

export const api = axios.create({
  baseURL,
  withCredentials: true, // Para enviar e receber cookies (Refresh Token)
});

/**
 * O access token vive em MEMÓRIA, nunca em localStorage (N3 da auditoria).
 *
 * Em localStorage, qualquer XSS — inclusive vindo de uma dependência — lê o
 * token e assume a sessão inteira. Numa variável de módulo ele some ao fechar
 * a aba e não é alcançável por `localStorage.getItem`, o que reduz o estrago de
 * um XSS de "roubo de sessão" para "abuso durante a aba aberta".
 *
 * Quem sustenta a sessão entre recarregamentos é o refresh token, que está no
 * lugar certo: cookie httpOnly + Secure + SameSite=strict, inacessível a JS.
 * O custo é um POST /auth/refresh a cada carga de página (ver bootstrapAuth).
 */
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

// Interceptor para injetar o Access Token
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/**
 * Renovação serializada do access token.
 *
 * O backend rotaciona o refresh token a cada uso e trata a reutilização de um
 * token já rotacionado como roubo, revogando TODAS as sessões do usuário
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
        setAccessToken(data.accessToken);
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

/**
 * Recupera a sessão ao carregar a página.
 *
 * Com o token em memória, um F5 esvazia tudo — é o cookie de refresh que diz se
 * ainda existe sessão. Retorna true se conseguiu restaurar. Reusa a mesma
 * promise compartilhada do interceptor, então chamar isto junto com requisições
 * em voo não gera refresh duplicado.
 */
export async function bootstrapAuth() {
  try {
    await refreshAccessToken();
    return true;
  } catch {
    clearAccessToken();
    return false;
  }
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
        const token = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh token falhou (inválido ou expirado), deslogar o usuário
        clearAccessToken();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
