import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Zap, Receipt } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";
import { useAuthStore } from "../store/authStore";

const BILLING_TYPES = [
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão de crédito" },
];

const STATUS_LABELS = {
  ACTIVE: { label: "Ativa", color: "text-green-500" },
  OVERDUE: { label: "Em atraso", color: "text-amber-500" },
  CANCELLED: { label: "Cancelada", color: "text-red-500" },
};

function formatBRL(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [pendingInvoice, setPendingInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [billingType, setBillingType] = useState("PIX");
  const [isAnnual, setIsAnnual] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState(null);
  const [busyAvulso, setBusyAvulso] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        api.get("/billing/plans"),
        api.get("/billing/subscription"),
      ]);
      setPlans(plansRes.data.plans.filter((p) => !p.isFounder));
      setSubscription(subRes.data.subscription);

      try {
        const invoiceRes = await api.get("/billing/subscription/invoice");
        setPendingInvoice(invoiceRes.data);
      } catch {
        setPendingInvoice(null);
      }
    } catch {
      toast.error("Erro ao carregar planos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleSubscribe = async (plan) => {
    setBusyPlanId(plan.id);
    try {
      await api.post("/billing/subscribe", { planId: plan.id, billingType, isAnnual });
      toast.success("Assinatura criada! Finalize o pagamento para ativar os créditos.");
      await fetchAll();
      await useAuthStore.getState().fetchBalance();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao assinar plano.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const handleUpgrade = async (plan) => {
    setBusyPlanId(plan.id);
    try {
      await api.post("/billing/subscription/upgrade", { planId: plan.id });
      toast.success("Plano alterado com sucesso.");
      await fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao trocar de plano.");
    } finally {
      setBusyPlanId(null);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm("Cancelar sua assinatura? Os créditos mensais restantes serão perdidos ao final do ciclo.")) return;
    setBusyCancel(true);
    try {
      await api.post("/billing/subscription/cancel");
      toast.success("Assinatura cancelada.");
      await fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao cancelar assinatura.");
    } finally {
      setBusyCancel(false);
    }
  };

  const handleAvulso = async () => {
    setBusyAvulso(true);
    try {
      const { data } = await api.post("/billing/avulso", { billingType });
      toast.success("Cobrança gerada! Finalize o pagamento para receber o crédito.");
      if (data.invoiceUrl) window.open(data.invoiceUrl, "_blank");
      await fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao comprar crédito avulso.");
    } finally {
      setBusyAvulso(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-zinc-500" /></div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Planos & Créditos</h1>
        <p className="text-zinc-400">Escolha uma assinatura mensal ou compre créditos avulsos.</p>
      </div>

      {subscription && (
        <div className="glass rounded-2xl border border-surface-border p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Assinatura atual</div>
            <div className="text-lg font-bold text-foreground">
              {subscription.plan?.name}{" "}
              <span className={`text-sm font-medium ${STATUS_LABELS[subscription.status]?.color || "text-zinc-400"}`}>
                · {STATUS_LABELS[subscription.status]?.label || subscription.status}
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Renova em {new Date(subscription.currentPeriodEnd).toLocaleDateString("pt-BR")}
              {subscription.founderLocked && " · Plano fundador travado por 12 meses"}
            </div>
          </div>
          {subscription.status !== "CANCELLED" && (
            <button
              onClick={handleCancel}
              disabled={busyCancel}
              className="text-red-400 hover:bg-red-400/10 border border-red-400/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
            >
              {busyCancel ? "Cancelando..." : "Cancelar assinatura"}
            </button>
          )}
        </div>
      )}

      {pendingInvoice?.payment && (
        <div className="glass rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-amber-500">Pagamento pendente</div>
            <div className="text-xs text-zinc-400 mt-1">
              {formatBRL(pendingInvoice.payment.amountBrl)} · vencimento em{" "}
              {pendingInvoice.payment.dueDate ? new Date(pendingInvoice.payment.dueDate).toLocaleDateString("pt-BR") : "-"}
            </div>
          </div>
          {(pendingInvoice.invoiceUrl || pendingInvoice.bankSlipUrl) && (
            <a
              href={pendingInvoice.invoiceUrl || pendingInvoice.bankSlipUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-amber-500 hover:bg-amber-600 text-black px-4 py-2 rounded-lg text-sm font-bold transition-colors shrink-0 text-center"
            >
              Ver cobrança
            </a>
          )}
        </div>
      )}

      <div className="glass rounded-2xl border border-surface-border p-6 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-sm font-medium text-zinc-300 mb-2">Forma de pagamento</div>
          <div className="flex gap-2">
            {BILLING_TYPES.map((bt) => (
              <button
                key={bt.value}
                onClick={() => setBillingType(bt.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  billingType === bt.value
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "border-surface-border text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {bt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={isAnnual} onChange={(e) => setIsAnnual(e.target.checked)} className="accent-primary w-4 h-4" />
          Cobrança anual (2 meses grátis)
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map((plan) => {
          const isCurrent = subscription?.planId === plan.id && subscription.status !== "CANCELLED";
          const busy = busyPlanId === plan.id;
          return (
            <div key={plan.id} className={`glass rounded-2xl border p-6 flex flex-col ${isCurrent ? "border-primary/40" : "border-surface-border"}`}>
              <div className="text-lg font-bold text-foreground mb-1">{plan.name}</div>
              <div className="text-2xl font-bold text-primary mb-1">
                {formatBRL(plan.priceBrl)}<span className="text-sm text-zinc-500 font-normal">/mês</span>
              </div>
              <div className="text-sm text-zinc-400 mb-4">
                {plan.creditsMonthly} laudos/mês · {plan.maxUsers} usuário{plan.maxUsers > 1 ? "s" : ""}
              </div>
              <div className="text-xs text-zinc-500 mb-6 flex-1">
                Excedente: {formatBRL(plan.excessPriceBrl)}/laudo
              </div>
              <button
                onClick={() => (subscription && subscription.status !== "CANCELLED" ? handleUpgrade(plan) : handleSubscribe(plan))}
                disabled={isCurrent || busy}
                className={`w-full py-2.5 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                  isCurrent
                    ? "bg-surface-border text-zinc-500 cursor-default"
                    : "bg-primary hover:bg-blue-600 text-white"
                }`}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {isCurrent ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Plano atual
                  </>
                ) : subscription && subscription.status !== "CANCELLED" ? (
                  "Trocar para este plano"
                ) : (
                  "Assinar"
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="glass rounded-2xl border border-surface-border p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-accent" />
          </div>
          <div>
            <div className="font-bold text-foreground">Crédito avulso — {formatBRL(79)}</div>
            <div className="text-xs text-zinc-500">1 laudo, sem assinatura, sem validade de expiração.</div>
          </div>
        </div>
        <button
          onClick={handleAvulso}
          disabled={busyAvulso}
          className="inline-flex items-center gap-2 bg-surface border border-surface-border hover:border-primary/40 text-foreground px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          {busyAvulso ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          Comprar
        </button>
      </div>
    </div>
  );
}
