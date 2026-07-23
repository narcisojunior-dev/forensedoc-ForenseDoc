import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Zap,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Ban,
  FileCheck,
  Users,
} from "lucide-react";
import { api } from "../lib/axios";
import { cn } from "../utils/cn";

// Intervalo de polling da contagem de não lidas. Curto o bastante para o
// usuário ver o resultado de uma análise, longo o bastante para não pesar.
const POLL_MS = 60_000;

const ICONS = {
  CREDITS_80PCT: { Icon: Zap, tone: "text-amber-500" },
  CREDITS_95PCT: { Icon: Zap, tone: "text-amber-500" },
  CREDITS_EXHAUSTED: { Icon: Zap, tone: "text-red-500" },
  PAYMENT_CONFIRMED: { Icon: CheckCircle2, tone: "text-emerald-500" },
  PAYMENT_FAILED: { Icon: CreditCard, tone: "text-red-500" },
  RENEWAL_REMINDER: { Icon: Calendar, tone: "text-primary" },
  ACCOUNT_SUSPENDED: { Icon: Ban, tone: "text-red-500" },
  ANALYSIS_ERROR: { Icon: AlertTriangle, tone: "text-amber-500" },
  ANALYSIS_COMPLETED: { Icon: FileCheck, tone: "text-emerald-500" },
  INVITE_RECEIVED: { Icon: Users, tone: "text-primary" },
  REFERRAL_CONVERTED: { Icon: Users, tone: "text-emerald-500" },
};

// Destino ao clicar — leva o usuário à ação que a notificação sugere.
const LINKS = {
  CREDITS_80PCT: "/dashboard/plans",
  CREDITS_95PCT: "/dashboard/plans",
  CREDITS_EXHAUSTED: "/dashboard/plans",
  PAYMENT_CONFIRMED: "/dashboard/plans",
  PAYMENT_FAILED: "/dashboard/plans",
  RENEWAL_REMINDER: "/dashboard/plans",
  ACCOUNT_SUSPENDED: "/dashboard/plans",
  ANALYSIS_ERROR: "/dashboard/analyze",
  ANALYSIS_COMPLETED: "/dashboard/history",
  INVITE_RECEIVED: "/dashboard/settings",
};

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  return new Date(dateString).toLocaleDateString("pt-BR");
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const fetchUnread = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnread(data.unreadCount);
    } catch {
      // Silencioso: o sino não pode virar fonte de erro na tela toda.
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications", { params: { limit: 10 } });
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const timer = setInterval(fetchUnread, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchUnread]);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchList();
  };

  const markRead = async (notification) => {
    if (notification.read) return;
    // Otimista: a UI responde na hora, o servidor confirma depois.
    setItems((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      await api.patch(`/notifications/${notification.id}/read`);
    } catch {
      fetchList();
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await api.post("/notifications/read-all");
    } catch {
      fetchList();
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : "Notificações"}
        className="relative p-2 rounded-lg text-zinc-400 hover:text-foreground hover:bg-surface-border/50 transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm bg-surface border border-surface-border rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
            <span className="text-sm font-bold text-foreground">Notificações</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-primary hover:underline"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">Carregando...</p>
            )}

            {!loading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Bell className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                <p className="text-sm text-zinc-500">Nenhuma notificação por aqui.</p>
              </div>
            )}

            {!loading &&
              items.map((n) => {
                const { Icon, tone } = ICONS[n.type] || {
                  Icon: Bell,
                  tone: "text-zinc-400",
                };
                return (
                  <Link
                    key={n.id}
                    to={LINKS[n.type] || "/dashboard"}
                    onClick={() => {
                      markRead(n);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex gap-3 px-4 py-3 border-b border-surface-border/60 last:border-0 hover:bg-surface-border/30 transition-colors",
                      !n.read && "bg-primary/[0.04]"
                    )}
                  >
                    <Icon className={cn("w-5 h-5 shrink-0 mt-0.5", tone)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={cn(
                            "text-sm leading-snug",
                            n.read ? "text-zinc-400" : "text-foreground font-semibold"
                          )}
                        >
                          {n.title}
                        </p>
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{n.body}</p>
                      <p className="text-[11px] text-zinc-600 mt-1.5">{timeAgo(n.createdAt)}</p>
                    </div>
                  </Link>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
