import { Navigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "../store/authStore";

/**
 * Protege as telas de admin da plataforma.
 *
 * Isto é apenas ergonomia: quem garante o acesso é o requirePlatformAdmin no
 * backend. Esconder a rota no cliente não protege nada por si só — qualquer
 * chamada direta à API continua sendo barrada lá.
 */
export default function AdminRoute({ children }) {
  const { user, isLoading } = useAuthStore();

  // O ProtectedRoute pai já resolveu o carregamento e a autenticação;
  // aqui só falta decidir sobre o papel.
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;

  if (!user.isPlatformAdmin) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center glass rounded-2xl border border-surface-border p-8">
        <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
          <ShieldAlert className="w-7 h-7 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Acesso restrito</h2>
        <p className="text-sm text-zinc-400">
          Esta área é exclusiva do operador da plataforma.
        </p>
      </div>
    );
  }

  return children;
}
