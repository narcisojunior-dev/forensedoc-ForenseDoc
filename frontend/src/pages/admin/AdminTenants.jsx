import { useState, useEffect, useCallback } from "react";
import { Search, Loader2, ChevronLeft, ChevronRight, Users2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/axios";
import { cn } from "../../utils/cn";
import TenantDetailModal from "./TenantDetailModal";

const STATUS_STYLES = {
  TRIAL: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  ACTIVE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  SUSPENDED: "bg-red-500/10 text-red-400 border-red-500/20",
  CANCELLED: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

const STATUS_LABELS = {
  TRIAL: "Trial",
  ACTIVE: "Ativa",
  SUSPENDED: "Suspensa",
  CANCELLED: "Cancelada",
};

export function StatusBadge({ status }) {
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap",
        STATUS_STYLES[status] || STATUS_STYLES.CANCELLED
      )}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function AdminTenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState(null);

  /**
   * `signal` descarta respostas obsoletas.
   *
   * O debounce reduz o número de requisições, mas não impede que duas fiquem em
   * voo: uma busca lenta disparada antes podia responder DEPOIS de uma rápida
   * disparada depois, sobrescrevendo a lista com o resultado do filtro antigo.
   * O AbortController cancela a anterior sempre que os filtros mudam.
   */
  const load = useCallback(async (signal) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/tenants", {
        params: { page, search: search || undefined, status: status || undefined },
        signal,
      });
      setTenants(data.tenants);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (error) {
      // Requisição cancelada não é erro do usuário — não vira toast nem
      // interrompe o loading, que a requisição seguinte já assumiu.
      if (error.code === "ERR_CANCELED" || error.name === "CanceledError") return;
      toast.error(error.response?.data?.error || "Erro ao carregar contas.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, search, status]);

  // Debounce da busca — evita uma requisição por tecla digitada.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => load(controller.signal), search ? 400 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, search]);

  // Trocar filtro volta para a primeira página, senão a paginação fica órfã.
  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
  };
  const handleStatus = (value) => {
    setStatus(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Buscar por nome, CPF/CNPJ ou e-mail..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-surface-border rounded-lg text-sm text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={status}
          onChange={(e) => handleStatus(e.target.value)}
          className="px-4 py-2.5 bg-surface border border-surface-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos os status</option>
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Ativas</option>
          <option value="SUSPENDED">Suspensas</option>
          <option value="CANCELLED">Canceladas</option>
        </select>
      </div>

      <div className="glass rounded-2xl border border-surface-border overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="py-16 text-center">
            <Users2 className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
            <p className="text-sm text-zinc-500">
              {search || status ? "Nenhuma conta encontrada com esses filtros." : "Nenhuma conta cadastrada ainda."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left">
                  <th className="px-4 py-3 font-medium text-zinc-400">Conta</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Status</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Plano</th>
                  <th className="px-4 py-3 font-medium text-zinc-400 text-right">Créditos</th>
                  <th className="px-4 py-3 font-medium text-zinc-400 text-right">Laudos</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const b = t.creditBalance;
                  const credits = b
                    ? b.creditsMonthly + b.creditsAvulso + b.creditsEmergency + b.creditsManual
                    : 0;
                  const owner = t.users?.find((u) => u.role === "OWNER") || t.users?.[0];
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className="border-b border-surface-border/50 last:border-0 hover:bg-surface-border/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-zinc-500">{owner?.email || t.cpfCnpj}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {t.subscription?.plan?.name || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">{credits}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">{t._count?.analyses ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            {total} conta{total === 1 ? "" : "s"} · página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-surface-border text-zinc-400 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg border border-surface-border text-zinc-400 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {selectedId && (
        <TenantDetailModal
          tenantId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
