import { useState } from "react";
import { Link } from "react-router-dom";
import { Scale, Loader2, MailCheck, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error("Informe seu e-mail.");

    setIsSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email });
      // O backend responde a mesma coisa exista ou não a conta (anti-enumeração),
      // então a tela também não pode revelar se o e-mail está cadastrado.
      setSent(true);
    } catch (error) {
      const status = error.response?.status;
      toast.error(
        status === 429
          ? "Muitas solicitações. Aguarde alguns minutos e tente novamente."
          : error.response?.data?.error || "Não foi possível enviar o e-mail. Tente novamente."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <Link to="/" className="inline-flex items-center gap-2 group mb-6">
          <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
            <Scale className="w-6 h-6 text-primary" />
          </div>
          <span className="font-bold text-2xl tracking-tight text-foreground">
            Forense<span className="text-primary">Doc</span>
          </span>
        </Link>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">
          {sent ? "Verifique seu e-mail" : "Recuperar acesso"}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {sent
            ? "Se o e-mail estiver cadastrado, enviamos as instruções."
            : "Enviaremos um link para você criar uma nova senha."}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          {sent ? (
            <div className="text-center space-y-5">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <MailCheck className="w-7 h-7 text-emerald-500" />
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Enviamos um link de redefinição para{" "}
                <span className="text-foreground font-medium">{email}</span>. O link vale por
                1 hora e só pode ser usado uma vez.
              </p>
              <p className="text-xs text-zinc-500">
                Não recebeu? Verifique a caixa de spam ou{" "}
                <button
                  onClick={() => setSent(false)}
                  className="text-primary hover:underline font-medium"
                >
                  tente outro e-mail
                </button>
                .
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-foreground transition-colors pt-2"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-medium text-zinc-300">E-mail da conta</label>
                <div className="mt-1">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    placeholder="voce@escritorio.com.br"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-primary hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Enviando...
                  </>
                ) : (
                  "Enviar link de recuperação"
                )}
              </button>

              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sm font-medium text-zinc-400 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
