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

// Interceptor para tratar expiração do Access Token (401)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Se erro for 401 e for erro de token expirado (verificamos a flag _retry para evitar loop infinito)
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Ignora se for a rota de login ou refresh (para não loopear)
      if (originalRequest.url.includes('/auth/login') || originalRequest.url.includes('/auth/refresh')) {
        return Promise.reject(error);
      }
      
      originalRequest._retry = true;
      
      try {
        // Tenta renovar o token
        const { data } = await axios.post(`${baseURL}/auth/refresh`, {}, { withCredentials: true });
        
        // Se sucesso, salva o novo token e refaz a requisição original
        localStorage.setItem("accessToken", data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
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
