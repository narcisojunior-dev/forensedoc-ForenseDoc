import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/axios";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState("loading"); // loading, success, error
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("Token de verificação ausente.");
      return;
    }

    const verify = async () => {
      try {
        await api.post("/auth/verify-email", { token });
        setStatus("success");
      } catch (error) {
        setStatus("error");
        setErrorMessage(error.response?.data?.error || "Ocorreu um erro ao verificar seu e-mail.");
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center glass p-10 rounded-2xl border-surface-border shadow-2xl relative overflow-hidden">
        
        {status === "loading" && (
          <div className="flex flex-col items-center">
            <Loader2 className="w-16 h-16 text-primary animate-spin mb-6" />
            <h2 className="text-2xl font-bold text-foreground">Verificando...</h2>
            <p className="text-zinc-400 mt-2">Aguarde enquanto validamos seu token.</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center animate-fade-in">
            <CheckCircle2 className="w-16 h-16 text-green-500 mb-6" />
            <h2 className="text-2xl font-bold text-foreground mb-4">E-mail Confirmado!</h2>
            <p className="text-zinc-400 mb-8">
              Sua conta foi ativada com sucesso. Seus 3 laudos gratuitos já estão disponíveis.
            </p>
            <Link 
              to="/login" 
              className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-primary hover:bg-blue-600 transition-colors shadow-lg"
            >
              Fazer Login e Começar
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center animate-fade-in">
            <XCircle className="w-16 h-16 text-red-500 mb-6" />
            <h2 className="text-2xl font-bold text-foreground mb-4">Falha na Verificação</h2>
            <p className="text-zinc-400 mb-8">{errorMessage}</p>
            <Link 
              to="/login" 
              className="text-primary hover:text-blue-400 font-medium transition-colors"
            >
              Ir para o Login
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}
