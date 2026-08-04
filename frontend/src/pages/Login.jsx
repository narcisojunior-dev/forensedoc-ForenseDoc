import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Scale, Loader2, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "../store/authStore";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  /*
   * Segundo passo do login.
   *
   * `challenge` vazio significa que estamos no passo da senha. Guardar o
   * desafio em estado, e não a senha, é o que permite reapresentar o código sem
   * manter a senha viva na memória da página depois de ela já ter sido aceita.
   */
  const [challenge, setChallenge] = useState("");
  const [recuperacaoDisponivel, setRecuperacaoDisponivel] = useState(false);
  const [codigo, setCodigo] = useState("");
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const verifyTotp = useAuthStore((state) => state.verifyTotp);

  const concluir = () => {
    toast.success("Login realizado com sucesso!");
    const user = useAuthStore.getState().user;
    const seenOnboarding = user && localStorage.getItem(`onboarding_seen_${user.id}`);
    navigate(seenOnboarding ? "/dashboard" : "/onboarding");
  };

  const voltarParaSenha = (mensagem) => {
    setChallenge("");
    setCodigo("");
    setPassword("");
    toast.error(mensagem);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      return toast.error("Preencha todos os campos.");
    }

    setIsSubmitting(true);
    const result = await login(email, password);
    setIsSubmitting(false);

    if (result.success) return concluir();

    if (result.totpRequired) {
      setChallenge(result.challenge);
      setRecuperacaoDisponivel(Boolean(result.recuperacaoDisponivel));
      return;
    }

    toast.error(result.error);
  };

  const handleTotp = async (e) => {
    e.preventDefault();
    if (!codigo.trim()) return toast.error("Informe o código.");

    setIsSubmitting(true);
    const result = await verifyTotp(challenge, codigo.trim());
    setIsSubmitting(false);

    if (result.success) {
      // Entrar por código de recuperação significa que o aplicativo se perdeu.
      // Avisar quantos sobraram evita a descoberta no dia em que acabarem.
      if (typeof result.codigosDeRecuperacaoRestantes === "number") {
        toast(
          `Código de recuperação usado. Restam ${result.codigosDeRecuperacaoRestantes}. ` +
            "Cadastre o aplicativo novamente em Configurações.",
          { duration: 8000 }
        );
      }
      return concluir();
    }

    if (result.expirado) return voltarParaSenha(result.error);

    setCodigo("");
    toast.error(result.error);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glow */}
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
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Acesse sua conta</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Ainda não tem conta?{" "}
          <Link to="/register" className="font-medium text-primary hover:text-blue-400 transition-colors">
            Cadastre-se grátis
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          {challenge ? (
            <form className="space-y-6" onSubmit={handleTotp}>
              <div className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface/60 p-4">
                <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="text-sm text-zinc-300">
                  <p className="font-medium text-foreground">Verificação em duas etapas</p>
                  <p className="mt-1 text-zinc-400">
                    Abra seu aplicativo autenticador e informe o código de 6 dígitos.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300" htmlFor="codigo-totp">
                  Código de verificação
                </label>
                <div className="mt-1">
                  <input
                    id="codigo-totp"
                    // `inputMode` numérico abre o teclado certo no celular, mas o
                    // type continua texto porque o campo também aceita código de
                    // recuperação, que tem letras e hífen.
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    className="block w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    placeholder="000000"
                    required
                  />
                </div>
                {recuperacaoDisponivel && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Sem acesso ao aplicativo? Use um dos códigos de recuperação que você guardou.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-primary hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Verificando...
                  </>
                ) : (
                  "Verificar e entrar"
                )}
              </button>

              <button
                type="button"
                onClick={() => voltarParaSenha("Login cancelado.")}
                className="w-full text-sm text-zinc-400 hover:text-foreground transition-colors"
              >
                Cancelar e entrar com outra conta
              </button>
            </form>
          ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-zinc-300">E-mail Corporativo</label>
              <div className="mt-1">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="voce@escritorio.com.br"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300">Senha</label>
              <div className="mt-1">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <div className="text-sm">
                <Link to="/forgot-password" className="font-medium text-primary hover:text-blue-400">
                  Esqueceu a senha?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-primary hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </button>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}
