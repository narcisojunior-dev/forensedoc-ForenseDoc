import { useState, useEffect } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { 
  LayoutDashboard, 
  FileSearch, 
  History, 
  CreditCard, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  Gavel,
  Shield
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { cn } from "../../utils/cn";
import CreditWidget from "../CreditWidget";
import NotificationBell from "../NotificationBell";
import logoImg from "../../assets/logo.png";

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuthStore();

  // Escape fecha a sidebar mobile. Todos os outros overlays do sistema fazem
  // isso; deixar um de fora é atrito gratuito para quem navega por teclado.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e) => e.key === "Escape" && setSidebarOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const navItems = [
    { name: "Visão Geral", path: "/dashboard", icon: LayoutDashboard },
    { name: "Nova Análise", path: "/dashboard/analyze", icon: FileSearch },
    { name: "Histórico", path: "/dashboard/history", icon: History },
    { name: "Réplica Processual", path: "/dashboard/replica", icon: Gavel },
    { name: "Planos & Créditos", path: "/dashboard/plans", icon: CreditCard },
    { name: "Configurações", path: "/dashboard/settings", icon: Settings },
    // Só o operador da plataforma vê o item; o acesso em si é barrado no backend.
    ...(user?.isPlatformAdmin
      ? [{ name: "Administração", path: "/dashboard/admin", icon: Shield }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden" 
          onClick={() => setSidebarOpen(false)} 
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-surface-border flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-surface-border">
          <Link to="/dashboard" className="flex items-center group py-1">
            <img src={logoImg} alt="ForenseDoc" className="h-8 w-auto object-contain transition-opacity group-hover:opacity-90" />
          </Link>
          <button className="md:hidden text-zinc-400 hover:text-foreground" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-zinc-400 hover:bg-surface-border/50 hover:text-zinc-200"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}

          <div className="mt-auto pt-4 flex flex-col gap-4">
            <CreditWidget />
            
            <button 
              onClick={logout}
              className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Sair
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b border-surface-border bg-background/80 backdrop-blur-md z-30 sticky top-0">
          <button 
            className="md:hidden text-zinc-400 hover:text-foreground" 
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-6 h-6" />
          </button>
          
          <div className="flex-1" />
          
          <div className="flex items-center gap-2 sm:gap-4">
            <NotificationBell />

            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-bold text-foreground">{user?.name}</span>
              <span className="text-xs text-zinc-500">{user?.tenant?.name || 'Escritório'}</span>
            </div>
            <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 relative flex flex-col">
          {/* Outlet renderiza a rota filha correspondente (Dashboard, History, etc) */}
          <div className="flex-1">
            <Outlet />
          </div>

          {/*
            O rodapé fica DENTRO da área rolável, e não abaixo dela, para não
            ocupar altura útil de forma permanente numa tela que já é densa. O
            `flex-1` acima empurra o rodapé para o fim quando a página é curta,
            e ele acompanha o conteúdo quando é longa.

            Os dois documentos precisam estar alcançáveis também aqui: o usuário
            que já entrou é justamente quem consulta prazo de retenção e direitos
            quando um cliente pergunta, e obrigá-lo a sair para a página inicial
            para achá-los é atrito sem motivo.
          */}
          <footer className="mt-10 border-t border-surface-border pt-5 text-xs text-zinc-500">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <p>© {new Date().getFullYear()} ForenseDoc</p>
              <nav className="flex items-center gap-5">
                <Link to="/termos" className="transition-colors hover:text-zinc-300">
                  Termos de Uso
                </Link>
                <Link to="/privacidade" className="transition-colors hover:text-zinc-300">
                  Política de Privacidade
                </Link>
              </nav>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
