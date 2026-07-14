import { Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function CreditWidget() {
  const { balance } = useAuthStore();

  if (!balance) return null;

  const { total, details } = balance;
  
  // Define o nível de atenção (vermelho se 0, amarelo se <= 2)
  const isCritical = total === 0;
  const isWarning = total > 0 && total <= 2;

  return (
    <div className="bg-surface border border-surface-border rounded-xl p-4 flex flex-col gap-3 shadow-md mt-auto">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-400 flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          Créditos
        </span>
        <span className={`text-xl font-bold ${isCritical ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-foreground'}`}>
          {total}
        </span>
      </div>

      <div className="space-y-1">
        {details.monthly > 0 && (
          <div className="flex justify-between text-xs text-zinc-500">
            <span>Plano Mensal</span>
            <span>{details.monthly}</span>
          </div>
        )}
        {details.avulso > 0 && (
          <div className="flex justify-between text-xs text-zinc-500">
            <span>Avulsos (Não expiram)</span>
            <span>{details.avulso}</span>
          </div>
        )}
      </div>

      <div className="h-px bg-surface-border my-1" />

      <Link
        to="/dashboard/plans"
        className={`w-full py-2 rounded-lg text-xs font-bold text-center transition-colors ${
          isCritical 
            ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20' 
            : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20'
        }`}
      >
        {isCritical ? 'Recarregar Agora' : 'Comprar Créditos'}
      </Link>
    </div>
  );
}
