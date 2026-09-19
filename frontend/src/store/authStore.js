import { create } from "zustand";
import { api, setAccessToken, clearAccessToken, getAccessToken, bootstrapAuth } from "../lib/axios";
import { motivoDoErro } from "../lib/logSafe";

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  balance: null, // { total, details: { monthly, avulso, emergency, manual } }
  
  // Ações
  login: async (email, password) => {
    try {
      const response = await api.post("/auth/login", { email, password });

      /*
       * Conta com segundo fator: o servidor não devolve token nenhum, só um
       * desafio de 5 minutos. A tela troca para o passo do código, e a sessão
       * só nasce em `verifyTotp`.
       */
      if (response.data.totpRequired) {
        return {
          success: false,
          totpRequired: true,
          challenge: response.data.challenge,
          recuperacaoDisponivel: response.data.recuperacaoDisponivel,
        };
      }

      setAccessToken(response.data.accessToken);

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

  /** Segundo passo: o desafio prova a senha, o código prova o aplicativo. */
  verifyTotp: async (challenge, codigo) => {
    try {
      const response = await api.post("/auth/totp/verify", { challenge, codigo });
      setAccessToken(response.data.accessToken);
      await useAuthStore.getState().checkAuth();
      return {
        success: true,
        codigosDeRecuperacaoRestantes: response.data.codigosDeRecuperacaoRestantes,
      };
    } catch (error) {
      return {
        success: false,
        // O desafio venceu: não adianta insistir no código, tem que refazer o
        // login. A tela precisa do código para voltar ao passo da senha.
        expirado: error.response?.data?.code === "TOTP_CHALLENGE_EXPIRED",
        error: error.response?.data?.error || "Não foi possível verificar o código.",
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
      console.error("Logout silencioso falhou:", motivoDoErro(err));
    } finally {
      clearAccessToken();
      set({ user: null, isAuthenticated: false });
    }
  },

  checkAuth: async () => {
    // Com o token em memória, um F5 zera tudo — quem diz se a sessão existe é o
    // cookie httpOnly de refresh. Só tenta restaurar quando não há token vivo,
    // para não gastar um refresh a cada montagem de rota protegida.
    if (!getAccessToken()) {
      const restaurada = await bootstrapAuth();
      if (!restaurada) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
    }

    try {
      const response = await api.get("/auth/me");
      set({ user: response.data.user, isAuthenticated: true, isLoading: false });
      
      // Busca saldo automaticamente ao logar
      await useAuthStore.getState().fetchBalance();
    } catch (error) {
      console.error("Sessão inválida ou expirada:", motivoDoErro(error));
      clearAccessToken();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  fetchBalance: async () => {
    try {
      const response = await api.get("/credits/balance");
      set({ balance: response.data.balance });
    } catch (error) {
      console.error("Erro ao buscar saldo:", motivoDoErro(error));
    }
  }
}));
