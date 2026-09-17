import { Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export default function CreditWidget() {
  const { balance } = useAuthStore();

  if (!balance) return null;

  const { total, details } = balance;

  // Administrador da plataforma: gera laudos sem consumir créditos, então não
  // há saldo a vigiar nem compra a oferecer.
  if (balance.unlimited) {
    return (
      <div className="bg-surface border border-surface-border rounded-xl p-4 flex flex-col gap-2 shadow-md mt-auto">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-400 flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            Créditos
          </span>
          <span className="text-xl font-bold text-foreground">Ilimitado</span>
        </div>
        <p className="text-xs text-zinc-500">Administrador da plataforma</p>
      </div>
    );
  }
  
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

      {/*
        As quatro bolsas, não duas. `total` soma monthly + avulso + emergency +
        manual, mas o detalhamento listava apenas as duas primeiras: um escritório
        com créditos de emergência ou de cortesia via um total que não fechava com
        nenhuma linha exibida.
      */}
      <div className="space-y-1">
        {[
          ["Plano mensal", details.monthly],
          ["Avulsos (não expiram)", details.avulso],
          ["Emergência", details.emergency],
          ["Cortesia", details.manual],
        ]
          .filter(([, valor]) => valor > 0)
          .map(([rotulo, valor]) => (
            <div key={rotulo} className="flex justify-between text-xs text-zinc-500">
              <span>{rotulo}</span>
              <span>{valor}</span>
            </div>
          ))}
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
