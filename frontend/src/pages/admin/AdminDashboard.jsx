import { useState, useEffect } from "react";
import {
  Loader2,
  TrendingUp,
  Users,
  FileText,
  AlertTriangle,
  Target,
  FileCheck2,
  RefreshCw,
} from "lucide-react";
import { api } from "../../lib/axios";
import { cn } from "../../utils/cn";
import QueueHealth from "./QueueHealth.jsx";

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
      <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
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
              {/*
                Rótulo do mês a cada 2 barras, para não colidir.

                Nas extremidades o texto é ancorado pela borda, e não pelo
                centro da barra: centralizado, metade do rótulo cai fora do
                viewBox e é cortada — "out. de 25" aparecia como "ut. de 25",
                que não é mês nenhum.
              */}
              {i % 2 === 0 && (
                <text
                  x={i === 0 ? 0 : i === data.length - 1 ? W : x + barW / 2}
                  y={H + 12}
                  textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                  fontSize="7"
                  fill="#71717a"
                >
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

/**
 * Participação de cada plano na base ativa.
 *
 * A lista anterior dava plano e contagem em texto, e nenhuma das duas perguntas
 * que essa tabela existe para responder — "a base está concentrada num plano
 * só?" e "quanto pesa o mais barato?" — se responde somando números de cabeça.
 * A barra resolve as duas de relance.
 *
 * Uma série, um matiz (o primário do sistema): a cor aqui codifica magnitude,
 * não identidade, então nada de uma cor por plano. O valor sai em tinta de
 * texto, não na cor da barra.
 */
function ParticipacaoPorPlano({ dados }) {
  const total = dados.reduce((s, p) => s + p.count, 0);
  if (total === 0) return null;

  const ordenado = [...dados].sort((a, b) => b.count - a.count);

  return (
    <div className="glass rounded-xl border border-surface-border p-5">
      <span className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-primary" /> Assinantes por plano
      </span>
      <div className="space-y-3">
        {ordenado.map((p) => {
          const pct = (p.count / total) * 100;
          return (
            <div key={p.plan}>
              <div className="flex items-baseline justify-between gap-4 text-sm mb-1.5">
                <span className="truncate text-zinc-400">{p.plan}</span>
                <span className="shrink-0 tabular-nums text-foreground">
                  <span className="font-semibold">{p.count}</span>
                  <span className="ml-2 text-xs text-zinc-500">{pct.toFixed(0)}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-border/70 overflow-hidden">
                {/* min de 2% para que um plano com 1 assinante ainda apareça */}
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-t border-surface-border pt-3 text-xs text-zinc-500 tabular-nums">
        {total} assinatura(s) ativa(s)
      </p>
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recarregando, setRecarregando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // `silencioso` recarrega sem trocar a tela pelo spinner: quem clica em
  // atualizar está comparando um número com o que acabou de ver, e apagar o
  // painel no meio da comparação desfaz justamente o que ele estava fazendo.
  const loadData = (silencioso = false) => {
    if (silencioso) setRecarregando(true);
    else setLoading(true);
    setErrorMsg(null);
    api
      .get("/admin/dashboard")
      .then((r) => {
        setData(r.data);
        setAtualizadoEm(new Date());
      })
      .catch((err) => {
        if (!silencioso) setData(null);
        setErrorMsg(err.response?.data?.error || "Não foi possível carregar as métricas.");
      })
      .finally(() => {
        setLoading(false);
        setRecarregando(false);
      });
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-12 text-center glass rounded-xl border border-surface-border p-6 max-w-md mx-auto my-8">
        <p className="text-sm text-zinc-300 mb-4">{errorMsg || "Não foi possível carregar as métricas."}</p>
        <button
          onClick={() => loadData()}
          className="px-4 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const faltaParaMeta = Math.max(0, data.breakEven.target - data.mrr);

  return (
    <div className="space-y-6">
      {/*
        Métrica financeira sem hora de leitura é métrica que o operador não sabe
        se é de agora ou da aba aberta ontem à noite.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {atualizadoEm
            ? `Leitura de ${atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
            : "—"}
          {errorMsg && (
            <span className="ml-2 text-amber-500">· falha ao atualizar, números anteriores mantidos</span>
          )}
        </p>
        <button
          onClick={() => loadData(true)}
          disabled={recarregando}
          className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200 hover:bg-surface-border/40 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", recarregando && "animate-spin")} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile icon={TrendingUp} label="MRR" value={money(data.mrr)} sub="receita mensal recorrente" tone="text-primary" />
        <StatTile icon={TrendingUp} label="ARR" value={money(data.arr)} sub="projeção anual" />
        <StatTile icon={Users} label="Assinantes ativos" value={data.activeSubscribers} sub={`${data.recentSignups} novos em 30 dias`} />
        {/*
          Laudos já vinham do /admin/dashboard e não eram mostrados em lugar
          nenhum. É o número de uso do produto: MRR diz o que foi cobrado, o
          laudo diz o que foi entregue, e conta atendida que parou de gerar
          laudo cancela antes de aparecer no churn.
        */}
        <StatTile
          icon={FileCheck2}
          label="Laudos no mês"
          value={data.analyses?.thisMonth ?? 0}
          sub={`${data.analyses?.total ?? 0} desde o início`}
        />
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Break-even (meta {money(data.breakEven.target)}/mês)
          </span>
          <span className={cn("text-sm font-bold tabular-nums", data.breakEven.achieved ? "text-emerald-500" : "text-amber-500")}>
            {data.breakEven.achieved ? "Atingido" : `${data.breakEven.pct}%`}
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-border overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", data.breakEven.achieved ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${Math.min(100, data.breakEven.pct)}%` }}
          />
        </div>
        {/*
          A porcentagem sozinha não diz o que fazer. O que falta em reais é
          acionável: dá para traduzir direto em quantas assinaturas ainda
          precisam entrar.
        */}
        <p className="mt-2 text-xs text-zinc-500">
          {data.breakEven.achieved
            ? `Meta superada em ${money(data.mrr - data.breakEven.target)}/mês.`
            : `Faltam ${money(faltaParaMeta)}/mês para cobrir o custo de operação.`}
        </p>
      </div>

      <QueueHealth />

      {/* Séries mensais — small multiples, escalas independentes */}
      <div className="grid md:grid-cols-2 gap-3">
        <MiniBarChart title="Novos cadastros / mês" data={data.monthly} valueKey="signups" color="#3b82f6" />
        <MiniBarChart title="Laudos gerados / mês" data={data.monthly} valueKey="analyses" color="#f59e0b" />
      </div>

      {/* Distribuição por plano */}
      {data.tenantsByPlan.length > 0 && <ParticipacaoPorPlano dados={data.tenantsByPlan} />}
    </div>
  );
}
