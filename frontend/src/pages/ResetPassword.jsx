import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldAlert, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";
import { passwordRules, checkPassword } from "../utils/passwordRules";
import logoImg from "../assets/logo.png";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const veredito = checkPassword(password);
  const meetsRequired = veredito.ok;
  const matches = password.length > 0 && password === confirm;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!meetsRequired) return toast.error(veredito.error);
    if (!matches) return toast.error("As senhas não conferem.");

    setIsSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: password });
      toast.success("Senha redefinida! Faça login com a nova senha.");
      navigate("/login");
    } catch (error) {
      toast.error(error.response?.data?.error || "Não foi possível redefinir a senha.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sem token na URL não há o que fazer — o link foi copiado errado.
  if (!token) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center glass p-8 rounded-2xl border border-surface-border">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
            <ShieldAlert className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Link inválido</h2>
          <p className="text-sm text-zinc-400 mb-6">
            Este link de redefinição está incompleto ou foi alterado. Solicite um novo.
          </p>
          <Link
            to="/forgot-password"
            className="inline-block w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-primary hover:bg-blue-600 transition-colors"
          >
            Solicitar novo link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <Link to="/" className="inline-flex items-center group mb-6">
          <img src={logoImg} alt="ForenseDoc" className="h-12 w-auto object-contain mx-auto transition-transform group-hover:scale-105" />
        </Link>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Criar nova senha</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Ao concluir, todas as sessões abertas serão encerradas.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-zinc-300">Nova senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="••••••••"
                required
                autoFocus
              />

              {password.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {passwordRules.map((rule) => {
                    const ok = rule.test(password);
                    return (
                      <li
                        key={rule.id}
                        className={`flex items-center gap-2 text-xs ${
                          ok ? "text-emerald-500" : "text-zinc-500"
                        }`}
                      >
                        {ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        {rule.label}
                        {!rule.required && <span className="text-zinc-600">(recomendado)</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300">Confirmar senha</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 block w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="••••••••"
                required
              />
              {confirm.length > 0 && !matches && (
                <p className="mt-2 text-xs text-red-500">As senhas não conferem.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !meetsRequired || !matches}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-primary hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Salvando...
                </>
              ) : (
                "Redefinir senha"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
