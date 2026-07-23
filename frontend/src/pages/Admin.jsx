import { useState } from "react";
import { Shield, Building2, Ticket } from "lucide-react";
import { cn } from "../utils/cn";
import AdminTenants from "./admin/AdminTenants";
import AdminFounders from "./admin/AdminFounders";

const TABS = [
  { id: "tenants", label: "Contas", icon: Building2, Component: AdminTenants },
  { id: "founders", label: "Convites Fundador", icon: Ticket, Component: AdminFounders },
];

export default function Admin() {
  const [active, setActive] = useState("tenants");
  const ActiveComponent = TABS.find((t) => t.id === active).Component;

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

      <div className="flex gap-1 border-b border-surface-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
              active === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </div>
  );
}
