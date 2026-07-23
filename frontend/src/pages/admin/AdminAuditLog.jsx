import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/axios";

function formatDateTime(value) {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Ações sensíveis (admin_*, suspensões) ganham destaque visual.
function actionTone(action) {
  if (action.startsWith("admin_") || action.includes("suspend")) return "text-amber-400";
  if (action.includes("payment") || action.includes("subscription")) return "text-emerald-400";
  return "text-zinc-400";
}

export default function AdminAuditLog() {
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/audit-logs", {
        params: { page, action: action || undefined, limit: 25 },
      });
      setLogs(data.logs);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
      // A lista de ações não muda com o filtro; preenche uma vez.
      if (data.actions?.length && actions.length === 0) setActions(data.actions);
    } catch {
      toast.error("Erro ao carregar a auditoria.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, action]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="px-4 py-2.5 bg-surface border border-surface-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todas as ações</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-zinc-500">{total} evento(s)</span>
      </div>

      <div className="glass rounded-2xl border border-surface-border overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <ScrollText className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
            <p className="text-sm text-zinc-500">Nenhum evento de auditoria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left">
                  <th className="px-4 py-3 font-medium text-zinc-400">Quando</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Ação</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Operador / usuário</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Escritório</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-surface-border/50 last:border-0">
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                    <td className={`px-4 py-3 font-medium ${actionTone(l.action)}`}>{l.action}</td>
                    <td className="px-4 py-3 text-zinc-400">{l.user?.email || "—"}</td>
                    <td className="px-4 py-3 text-zinc-400">{l.tenant?.name || "—"}</td>
                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{l.ipAddress || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">página {page} de {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 rounded-lg border border-surface-border text-zinc-400 hover:text-foreground disabled:opacity-40 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-2 rounded-lg border border-surface-border text-zinc-400 hover:text-foreground disabled:opacity-40 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
