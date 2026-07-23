import { useState, useEffect } from "react";
import { Loader2, TrendingUp, Users, FileText, AlertTriangle, Target } from "lucide-react";
import { api } from "../../lib/axios";
import { cn } from "../../utils/cn";

function money(v) {
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatTile({ icon: Icon, label, value, sub, tone = "text-foreground" }) {
  return (
    <div className="glass rounded-xl border border-surface-border p-5">
      <div className="flex items-center gap-2 mb-2 text-zinc-500">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", tone)}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

/**
 * Mini-gráfico de barras, uma série (small multiple).
 *
 * Cadastros e laudos têm escalas diferentes, então cada um vai no seu próprio
 * gráfico — nunca dois eixos y no mesmo plano. Single-series dispensa legenda
 * (o título nomeia a série) e não há par categórico adjacente para conferir.
 */
function MiniBarChart({ title, data, valueKey, color }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const total = data.reduce((s, d) => s + d[valueKey], 0);
  const W = 320;
  const H = 90;
  const gap = 4;
  const barW = (W - gap * (data.length - 1)) / data.length;

  return (
    <div className="glass rounded-xl border border-surface-border p-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-zinc-500">{total} em 12 meses</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label={title}>
        {data.map((d, i) => {
          const h = (d[valueKey] / max) * H;
          const x = i * (barW + gap);
          const y = H - h;
          return (
            <g key={d.month}>
              {/* trilho recessivo do valor cheio */}
              <rect x={x} y={0} width={barW} height={H} fill={color} opacity="0.08" rx="3" />
              <rect x={x} y={y} width={barW} height={Math.max(h, 1)} fill={color} rx="3">
                <title>{`${d.month}: ${d[valueKey]}`}</title>
              </rect>
              {/* rótulo do mês a cada 2 barras, para não colidir */}
              {i % 2 === 0 && (
                <text x={x + barW / 2} y={H + 12} textAnchor="middle" fontSize="7" fill="#71717a">
                  {d.month}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/admin/dashboard")
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-zinc-500 py-10 text-center">Não foi possível carregar as métricas.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={TrendingUp} label="MRR" value={money(data.mrr)} sub="receita mensal recorrente" tone="text-primary" />
        <StatTile icon={TrendingUp} label="ARR" value={money(data.arr)} sub="projeção anual" />
        <StatTile icon={Users} label="Assinantes ativos" value={data.activeSubscribers} sub={`${data.recentSignups} novos em 30 dias`} />
        <StatTile
          icon={AlertTriangle}
          label="Churn (mês)"
          value={`${data.churn.pct}%`}
          sub={`${data.churn.count} cancelamento(s)`}
          tone={data.churn.pct > 5 ? "text-red-500" : "text-foreground"}
        />
      </div>

      {/* Break-even */}
      <div className="glass rounded-xl border border-surface-border p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Break-even (meta {money(data.breakEven.target)}/mês)
          </span>
          <span className={cn("text-sm font-bold", data.breakEven.achieved ? "text-emerald-500" : "text-amber-500")}>
            {data.breakEven.achieved ? "Atingido" : `${data.breakEven.pct}%`}
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-border overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", data.breakEven.achieved ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${Math.min(100, data.breakEven.pct)}%` }}
          />
        </div>
      </div>

      {/* Séries mensais — small multiples, escalas independentes */}
      <div className="grid md:grid-cols-2 gap-3">
        <MiniBarChart title="Novos cadastros / mês" data={data.monthly} valueKey="signups" color="#3b82f6" />
        <MiniBarChart title="Laudos gerados / mês" data={data.monthly} valueKey="analyses" color="#f59e0b" />
      </div>

      {/* Distribuição por plano */}
      {data.tenantsByPlan.length > 0 && (
        <div className="glass rounded-xl border border-surface-border p-5">
          <span className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-primary" /> Assinantes por plano
          </span>
          <div className="space-y-1.5">
            {data.tenantsByPlan.map((p) => (
              <div key={p.plan} className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">{p.plan}</span>
                <span className="font-semibold text-foreground">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
