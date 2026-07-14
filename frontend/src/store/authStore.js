import { create } from "zustand";
import { api } from "../lib/axios";

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  balance: null, // { total, details: { monthly, avulso, emergency, manual } }
  
  // Ações
  login: async (email, password) => {
    try {
      const response = await api.post("/auth/login", { email, password });
      const { accessToken } = response.data;
      localStorage.setItem("accessToken", accessToken);
      
      // Busca dados do usuário após login
      await useAuthStore.getState().checkAuth();
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || "Erro ao fazer login." 
      };
    }
  },

  register: async (data) => {
    try {
      const response = await api.post("/auth/register", data);
      return { success: true, message: response.data.message };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || "Erro ao criar conta." 
      };
    }
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.error("Logout silencioso falhou:", err);
    } finally {
      localStorage.removeItem("accessToken");
      set({ user: null, isAuthenticated: false });
    }
  },

  checkAuth: async () => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    try {
      const response = await api.get("/auth/me");
      set({ user: response.data.user, isAuthenticated: true, isLoading: false });
      
      // Busca saldo automaticamente ao logar
      await useAuthStore.getState().fetchBalance();
    } catch (error) {
      console.error("Sessão inválida ou expirada", error);
      localStorage.removeItem("accessToken");
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  fetchBalance: async () => {
    try {
      const response = await api.get("/credits/balance");
      set({ balance: response.data.balance });
    } catch (error) {
      console.error("Erro ao buscar saldo:", error);
    }
  }
}));
