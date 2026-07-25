import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileSearch, Clock, Zap, ArrowRight, Activity, Receipt, CalendarDays } from "lucide-react";
import { api } from "../lib/axios";
import { useAuthStore } from "../store/authStore";
import toast from "react-hot-toast";

/**
 * Card de estatística do topo (L4).
 *
 * `value === null` significa "ainda carregando" e rende um placeholder — antes
 * os cards mostravam `0` fixo durante o fetch, o que fazia um escritório com
 * dezenas de laudos piscar "0" a cada visita.
 */
function StatCard({ icon: Icon, iconClass, label, value, suffix, hint }) {
  return (
    <div className="glass p-6 rounded-2xl border-surface-border">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${iconClass}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-zinc-400 text-sm font-medium">{label}</p>
          {value === null ? (
            <div className="h-9 flex items-center">
              <span className="inline-block w-12 h-6 rounded bg-surface-border/60 animate-pulse" />
            </div>
          ) : (
            <p className="text-3xl font-bold text-foreground">
              {value}
              {suffix}
            </p>
          )}
          {hint && <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, balance } = useAuthStore();
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const { data } = await api.get("/credits/transactions?limit=5");
        setTransactions(data.transactions);
      } catch (error) {
        toast.error("Erro ao carregar histórico de atividades.");
      } finally {
        setLoadingTx(false);
      }
    };

    // Contadores reais de laudos. Falha aqui não merece toast: os cards
    // seguem em estado de carregamento e o resto do dashboard funciona.
    const fetchStats = async () => {
      try {
        const { data } = await api.get("/analyses/stats");
        setStats(data.stats);
      } catch {
        /* silencioso de propósito */
      }
    };

    fetchTransactions();
    fetchStats();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Olá, {user?.name.split(" ")[0]}</h1>
          <p className="text-zinc-400">Aqui está o resumo do seu escritório hoje.</p>
        </div>
        <Link 
          to="/dashboard/analyze" 
          className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-primary/20"
        >
          <FileSearch className="w-5 h-5" />
          Nova Análise
        </Link>
      </div>

      {/* Grid de Estatísticas (Cards) — todos os números vêm do banco. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          icon={Zap}
          iconClass="bg-accent/10 border border-accent/20 text-accent"
          label="Créditos Disponíveis"
          value={balance?.total ?? null}
        />

        <StatCard
          icon={FileSearch}
          iconClass="bg-primary/10 border border-primary/20 text-primary"
          label="Laudos Gerados"
          value={stats ? stats.completedTotal : null}
          hint={stats?.processing > 0 ? `${stats.processing} em processamento` : null}
        />

        <StatCard
          icon={CalendarDays}
          iconClass="bg-green-500/10 border border-green-500/20 text-green-500"
          label="Laudos Este Mês"
          value={stats ? stats.completedThisMonth : null}
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Atividade Recente (Extrato de Créditos / Ações) */}
        <div className="lg:col-span-2 glass rounded-2xl border border-surface-border overflow-hidden flex flex-col">
          <div className="p-6 border-b border-surface-border flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Atividade Recente
            </h2>
            <Link to="/dashboard/history" className="text-sm text-primary hover:text-blue-400 font-medium flex items-center gap-1">
              Ver histórico
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          
          <div className="p-6 flex-1 flex flex-col justify-center">
            {loadingTx ? (
              <div className="flex justify-center p-8"><Clock className="w-6 h-6 animate-spin text-zinc-500" /></div>
            ) : transactions.length > 0 ? (
              <div className="space-y-4">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-3 border-b border-surface-border/50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.amount > 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                        {tx.amount > 0 ? '+' : '-'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-200">
                          {tx.type === 'EARN_AVULSO' ? 'Créditos Adicionados' : 
                           tx.type === 'SPEND' ? 'Análise Realizada' : 
                           tx.type === 'REFUND' ? 'Estorno de Análise' : tx.type}
                        </p>
                        <p className="text-xs text-zinc-500">{new Date(tx.createdAt).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                    <div className={`font-bold ${tx.amount > 0 ? 'text-green-500' : 'text-foreground'}`}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Receipt className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">Nenhuma atividade registrada ainda.</p>
                <p className="text-sm text-zinc-500 mt-1">Sua primeira análise aparecerá aqui.</p>
              </div>
            )}
          </div>
        </div>

        {/* Card Dica / Onboarding */}
        <div className="glass p-6 rounded-2xl border-surface-border bg-gradient-to-br from-surface to-primary/5">
          <h3 className="font-bold text-lg mb-2 text-foreground">Como começar?</h3>
          <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
            O ForenseDoc funciona melhor com PDFs de processos judiciais completos. O motor realiza OCR automático em páginas escaneadas.
          </p>
          <ul className="space-y-3 text-sm text-zinc-300">
            <li className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">1</div>
              <span>Clique em <strong>Nova Análise</strong>.</span>
            </li>
            <li className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">2</div>
              <span>Faça o upload do seu arquivo PDF (até 20 mil páginas).</span>
            </li>
            <li className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">3</div>
              <span>Aguarde o processamento e visualize o laudo estruturado.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
