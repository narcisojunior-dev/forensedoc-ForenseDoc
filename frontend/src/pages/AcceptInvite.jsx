import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Scale, Loader2, Users, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";
import { useAuthStore } from "../store/authStore";

/**
 * Tela de aceite de convite de equipe (L2).
 *
 * Rota pública `/invite/:token` — é o destino do link montado em
 * `tenantController.inviteMember` (`${FRONTEND_URL}/invite/${inviteToken}`) e
 * enviado pelo template `INVITE_RECEIVED`.
 *
 * O backend aceita apenas `name` e `password` (`acceptInviteSchema`): o e-mail
 * vem do próprio convite e não é editável — é o que o titular cadastrou, e
 * trocá-lo aqui permitiria resgatar o convite de outra pessoa.
 */

// Cada recusa tem CTA próprio: expirado e já aceito são situações diferentes
// para o convidado, e mandar todo mundo para a mesma tela de erro esconde o
// que ele precisa fazer.
const INVITE_ERRORS = {
  INVITE_NOT_FOUND: {
    title: "Convite não encontrado",
    message: "O link pode ter sido digitado incorretamente ou o convite foi revogado pelo escritório.",
  },
  INVITE_EXPIRED: {
    title: "Convite expirado",
    message: "Convites valem por 72 horas. Peça ao titular do escritório que envie um novo.",
  },
  INVITE_ALREADY_ACCEPTED: {
    title: "Convite já utilizado",
    message: "Esta conta já foi criada. Faça login normalmente com o seu e-mail.",
    action: { to: "/login", label: "Ir para o login" },
  },
  EMAIL_ALREADY_REGISTERED: {
    title: "E-mail já cadastrado",
    message: "Já existe uma conta com este e-mail. Faça login ou use a recuperação de senha.",
    action: { to: "/login", label: "Ir para o login" },
  },
  PLAN_USER_LIMIT_REACHED: {
    title: "Escritório sem vagas",
    message:
      "O escritório atingiu o limite de usuários do plano enquanto o convite estava pendente. Peça ao titular para liberar uma vaga ou fazer upgrade.",
  },
};

function Shell({ children }) {
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
      </div>
      <div className="mt-2 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1">{label}</label>
      <input
        {...props}
        className="block w-full px-4 py-2.5 bg-surface border border-surface-border rounded-lg text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      />
      {hint && <p className="text-xs text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  const [invite, setInvite] = useState(null);
  const [failure, setFailure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const describeFailure = (error, fallbackTitle) => {
    const code = error.response?.data?.code;
    return (
      INVITE_ERRORS[code] || {
        title: fallbackTitle,
        message: error.response?.data?.error || "Tente novamente em alguns instantes.",
      }
    );
  };

  useEffect(() => {
    const loadInvite = async () => {
      try {
        const { data } = await api.get(`/tenant/invite/${encodeURIComponent(token)}`);
        setInvite(data);
      } catch (error) {
        setFailure(describeFailure(error, "Não foi possível abrir o convite"));
      } finally {
        setLoading(false);
      }
    };
    loadInvite();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return toast.error("As senhas não conferem.");
    }

    setSubmitting(true);
    try {
      await api.post(`/tenant/invite/${encodeURIComponent(token)}/accept`, { name, password });

      // `acceptInvite` responde 201 sem token: a conta nasce com
      // emailVerified=true, então o login normal funciona de imediato e não
      // duplicamos a lógica de sessão aqui.
      const result = await login(invite.email, password);
      if (result.success) {
        toast.success(`Bem-vindo à equipe ${invite.tenantName}!`);
        navigate("/dashboard");
      } else {
        // Conta criada, sessão não. Não é erro fatal — o login manual resolve.
        toast.success("Conta criada! Faça login para continuar.");
        navigate("/login");
      }
    } catch (error) {
      const detail = describeFailure(error, "Não foi possível aceitar o convite");
      // Limite de vaga estourado entre o envio e o aceite é definitivo: troca a
      // tela em vez de deixar o formulário sugerindo nova tentativa.
      if (error.response?.data?.code === "PLAN_USER_LIMIT_REACHED") {
        setInvite(null);
        setFailure(detail);
      } else {
        toast.error(detail.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </Shell>
    );
  }

  if (failure) {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-foreground">{failure.title}</h1>
          <p className="text-sm text-zinc-400 mt-2">{failure.message}</p>
          <Link
            to={failure.action?.to || "/"}
            className="inline-block mt-6 text-sm font-medium text-primary hover:text-blue-400 transition-colors"
          >
            {failure.action?.label || "Voltar ao início"}
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
          <Users className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-xl font-bold text-foreground">
          Você foi convidado para {invite.tenantName}
        </h1>
        <p className="text-sm text-zinc-400 mt-2">
          {invite.invitedByName ? `${invite.invitedByName} convidou você` : "Você foi convidado"} para
          usar os laudos do escritório. Defina sua senha para entrar.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="E-mail"
          type="email"
          value={invite.email}
          disabled
          readOnly
          hint="Definido pelo convite e não pode ser alterado."
        />
        <Field
          label="Nome completo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={3}
          placeholder="Como você assina profissionalmente"
        />
        <Field
          label="Senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          hint="Mínimo de 8 caracteres."
        />
        <Field
          label="Confirmar senha"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold transition-colors disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Aceitar convite e entrar
        </button>

        <p className="text-xs text-zinc-500 text-center">
          Os laudos consumidos por você saem do saldo do escritório.
        </p>
      </form>
    </Shell>
  );
}
