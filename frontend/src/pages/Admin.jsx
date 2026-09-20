import { useState } from "react";
import { Shield, Building2, Ticket, LayoutDashboard, CreditCard, ScrollText } from "lucide-react";
import { cn } from "../utils/cn";
import AdminDashboard from "./admin/AdminDashboard";
import AdminTenants from "./admin/AdminTenants";
import AdminPlans from "./admin/AdminPlans";
import AdminAuditLog from "./admin/AdminAuditLog";
import AdminFounders from "./admin/AdminFounders";

const TABS = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard, Component: AdminDashboard },
  { id: "tenants", label: "Contas", icon: Building2, Component: AdminTenants },
  { id: "plans", label: "Planos", icon: CreditCard, Component: AdminPlans },
  { id: "audit", label: "Auditoria", icon: ScrollText, Component: AdminAuditLog },
  { id: "founders", label: "Convites Fundador", icon: Ticket, Component: AdminFounders },
];

export default function Admin() {
  const [active, setActive] = useState("dashboard");
  const abaAtiva = TABS.find((t) => t.id === active) || TABS[0];
  const ActiveComponent = abaAtiva.Component;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Administração</h1>
        </div>
        <p className="text-sm text-zinc-400">
          Área do operador da plataforma — gestão de contas e vagas de fundador.
        </p>
      </header>

      {/*
        A faixa rola na horizontal no lugar de quebrar em duas linhas: cinco
        abas não cabem na largura de um celular, e uma segunda linha de abas
        empurra o conteúdo para fora da primeira dobra justo quando o operador
        está consultando o painel no meio de um incidente.
      */}
      <div
        role="tablist"
        aria-label="Seções da administração"
        className="flex gap-1 overflow-x-auto border-b border-surface-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const selecionada = active === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`aba-${tab.id}`}
              aria-selected={selecionada}
              aria-controls={`painel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                selecionada
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`painel-${abaAtiva.id}`} aria-labelledby={`aba-${abaAtiva.id}`}>
        <ActiveComponent />
      </div>
    </div>
  );
}
