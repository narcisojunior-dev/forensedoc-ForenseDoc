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
  Shield,
  ChevronsRight,
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { cn } from "../../utils/cn";
import CreditWidget from "../CreditWidget";
import NotificationBell from "../NotificationBell";
import logoImg from "../../assets/logo.png";

/**
 * Casca do sistema: sidebar navegável + topbar + área da rota filha.
 *
 * ─── Dois estados independentes de sidebar ──────────────────────────────────
 *
 * `sidebarOpen` é a gaveta do mobile (overlay por cima do conteúdo, sempre em
 * largura cheia). `colapsada` é o trilho do desktop (64px só com ícones). São
 * coisas diferentes e não podem compartilhar o mesmo booleano: quem trabalha no
 * desktop com o trilho recolhido e abre a mesma conta no celular precisa ver o
 * menu com os rótulos, porque lá não existe hover nem tooltip para recuperar o
 * nome de um pictograma.
 *
 * Por isso toda classe do modo recolhido é prefixada com `md:` — abaixo desse
 * ponto o menu ignora o colapso.
 */

const CHAVE_COLAPSO = "forensedoc:sidebar-colapsada";

// A preferência de trilho recolhido é de quem usa, não da sessão: quem analisa
// laudo lado a lado com o processo recolhe uma vez e espera achar assim amanhã.
// O acesso vai em try/catch porque em navegação anônima o localStorage existe
// mas pode lançar na leitura.
function lerColapso() {
  try {
    return localStorage.getItem(CHAVE_COLAPSO) === "1";
  } catch {
    return false;
  }
}

/** Rótulo de seção. Some no trilho recolhido e dá lugar a um filete divisor. */
function RotuloGrupo({ children, colapsada }) {
  return (
    <>
      <div
        className={cn(
          "px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-600",
          colapsada && "md:hidden"
        )}
      >
        {children}
      </div>
      {colapsada && <div className="mx-2 my-2 hidden h-px bg-surface-border md:block" />}
    </>
  );
}

function ItemNav({ item, colapsada, ativo, onNavigate }) {
  return (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={ativo ? "page" : undefined}
      // Sem o `title` o item recolhido vira um pictograma sem nome. O texto
      // também fica no aria-label porque o <span> do rótulo sai do fluxo.
      title={item.name}
      aria-label={item.name}
      className={cn(
        "flex h-11 items-center rounded-lg border text-sm font-medium transition-all duration-200",
        colapsada ? "gap-3 px-3 md:justify-center md:gap-0 md:px-0" : "gap-3 px-3",
        ativo
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-transparent text-zinc-400 hover:bg-surface-border/50 hover:text-zinc-200"
      )}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      <span className={cn(colapsada && "md:hidden")}>{item.name}</span>
    </Link>
  );
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [colapsada, setColapsada] = useState(lerColapso);
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

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_COLAPSO, colapsada ? "1" : "0");
    } catch {
      // Storage bloqueado: o colapso vale só para esta aba, o que é melhor que
      // derrubar a tela inteira por causa de uma preferência visual.
    }
  }, [colapsada]);

  /*
   * A navegação é agrupada, não uma lista corrida.
   *
   * "Administração" abre antes de "Visão Geral" porque quem tem o item é o
   * operador da plataforma, e para ele a fila de processamento e o estado das
   * contas vêm antes do próprio painel de escritório. O grupo separado também
   * deixa explícito que aquilo é poder de plataforma, não de tenant — o item
   * solto no fim da lista não distinguia um do outro.
   */
  const grupos = [
    ...(user?.isPlatformAdmin
      ? [
          {
            id: "plataforma",
            rotulo: "Plataforma",
            // Só o operador vê o item; o acesso em si é barrado no backend.
            itens: [{ name: "Administração", path: "/dashboard/admin", icon: Shield }],
          },
        ]
      : []),
    {
      id: "trabalho",
      rotulo: "Trabalho",
      itens: [
        { name: "Visão Geral", path: "/dashboard", icon: LayoutDashboard },
        { name: "Nova Análise", path: "/dashboard/analyze", icon: FileSearch },
        // O laudo é aberto a partir do histórico e não tem item próprio. Sem
        // isso, a tela de laudo deixava a sidebar inteira sem marcação de onde
        // se está.
        { name: "Histórico", path: "/dashboard/history", icon: History, tambem: ["/dashboard/laudo"] },
        // Réplica Processual sai do menu enquanto o motor estiver em
        // desenvolvimento. A tela e o engine continuam no repositório; para
        // religar, devolver o item aqui e a rota em App.jsx.
      ],
    },
    {
      id: "conta",
      rotulo: "Conta",
      itens: [
        { name: "Planos & Créditos", path: "/dashboard/plans", icon: CreditCard },
        { name: "Configurações", path: "/dashboard/settings", icon: Settings },
      ],
    },
  ];

  const ehAtivo = (item) =>
    location.pathname === item.path ||
    (item.tambem || []).some((prefixo) => location.pathname.startsWith(prefixo));

  const fecharMobile = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={fecharMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-surface-border bg-surface transition-all duration-300 ease-in-out md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          colapsada && "md:w-16"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center justify-between border-b border-surface-border px-6",
            colapsada && "md:justify-center md:px-2"
          )}
        >
          <Link to="/dashboard" className="group flex items-center py-1" onClick={fecharMobile}>
            {/* 600×335 na origem: a h-8 o logo ocupa ~57px e não cabe nos 48px
                úteis do trilho, então ele encolhe junto com a sidebar. */}
            <img
              src={logoImg}
              alt="ForenseDoc"
              className={cn(
                "w-auto object-contain transition-all group-hover:opacity-90",
                colapsada ? "h-8 md:h-6" : "h-8"
              )}
            />
          </Link>
          <button
            className="text-zinc-400 hover:text-foreground md:hidden"
            onClick={fecharMobile}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          aria-label="Navegação principal"
          className={cn(
            "flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-4",
            colapsada && "md:px-2"
          )}
        >
          {grupos.map((grupo) => (
            <div key={grupo.id} className="flex flex-col gap-1">
              <RotuloGrupo colapsada={colapsada}>{grupo.rotulo}</RotuloGrupo>
              {grupo.itens.map((item) => (
                <ItemNav
                  key={item.path}
                  item={item}
                  colapsada={colapsada}
                  ativo={ehAtivo(item)}
                  onNavigate={fecharMobile}
                />
              ))}
            </div>
          ))}

          <div className="mt-auto flex flex-col gap-4 pt-4">
            {/* O medidor de créditos é um cartão com número e texto: no trilho
                de 64px ele não tem como caber legível, e um saldo cortado pela
                metade é pior que saldo nenhum. */}
            <div className={cn(colapsada && "md:hidden")}>
              <CreditWidget />
            </div>

            <button
              onClick={logout}
              title="Sair"
              aria-label="Sair"
              className={cn(
                "flex h-11 items-center rounded-lg text-sm font-medium text-red-400 transition-colors hover:bg-red-400/10",
                colapsada ? "gap-3 px-3 md:justify-center md:gap-0 md:px-0" : "gap-3 px-3"
              )}
            >
              <LogOut className="h-5 w-5 shrink-0" />
              <span className={cn(colapsada && "md:hidden")}>Sair</span>
            </button>
          </div>
        </nav>

        {/* Recolher é ação de desktop: no mobile a sidebar é gaveta e quem fecha
            é o X do topo ou o toque fora. */}
        <button
          onClick={() => setColapsada((v) => !v)}
          aria-expanded={!colapsada}
          aria-label={colapsada ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "hidden h-12 shrink-0 items-center border-t border-surface-border text-zinc-500 transition-colors hover:bg-surface-border/40 hover:text-zinc-300 md:flex",
            colapsada ? "justify-center px-0" : "gap-3 px-5"
          )}
        >
          <ChevronsRight
            className={cn("h-5 w-5 transition-transform duration-300", !colapsada && "rotate-180")}
          />
          {!colapsada && <span className="text-sm font-medium">Recolher</span>}
        </button>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b border-surface-border bg-background/80 backdrop-blur-md z-30 sticky top-0">
          <button
            className="md:hidden text-zinc-400 hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
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
