import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Zap, Receipt, Award, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";
import { useAuthStore } from "../store/authStore";
import { getFounderCode, clearFounderCode } from "../utils/founderInvite";
import ConfirmDialog from "../components/ConfirmDialog";

// Mensagens dos erros que o backend devolve ao validar o convite de fundador.
// Cada caso tem tratamento próprio: "inválido" pede conferência do link,
// "usado" e "esgotado" são definitivos e o card não deve aparecer.
const FOUNDER_ERRORS = {
  FOUNDER_INVITE_INVALID: "Este código de convite de fundador não é válido. Confira o link recebido.",
  FOUNDER_INVITE_USED: "Este convite de fundador já foi utilizado.",
  FOUNDER_SLOTS_EXHAUSTED: "As 25 vagas de fundador se esgotaram.",
  FOUNDER_PLAN_UNAVAILABLE: "O plano de fundador não está disponível no momento.",
  FOUNDER_INVITE_RATE_LIMITED: "Muitas tentativas de validação. Aguarde alguns minutos.",
};

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
  // Preço do avulso já resolvido pelo backend para este tenant (com ou sem o
  // desconto de assinante). Nunca calcular no frontend: quem cobra é o backend.
  const [avulso, setAvulso] = useState(null);
  const [pendingInvoice, setPendingInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [billingType, setBillingType] = useState("PIX");
  const [isAnnual, setIsAnnual] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState(null);
  const [busyAvulso, setBusyAvulso] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Convite de fundador: `founder` só é preenchido depois que o backend
  // confirma o código. `founderError` guarda o motivo da recusa, para explicar
  // ao convidado em vez de simplesmente não mostrar o plano.
  const [founder, setFounder] = useState(null);
  const [founderError, setFounderError] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        api.get("/billing/plans"),
        api.get("/billing/subscription"),
      ]);
      // O plano fundador nunca entra na vitrine geral — só aparece pelo card
      // dedicado, e apenas para quem chegou com um código válido.
      setPlans(plansRes.data.plans.filter((p) => !p.isFounder));
      setSubscription(subRes.data.subscription);
      setAvulso(subRes.data.avulso);

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

  // Valida o código antes de qualquer submit: descobrir que o convite é
  // inválido só na hora de assinar já teria criado o cliente na Asaas.
  const checkFounderCode = async () => {
    const code = getFounderCode();
    if (!code) return;

    try {
      const { data } = await api.get(`/billing/founder-invite/${encodeURIComponent(code)}`);
      setFounder(data);
      setFounderError(null);
    } catch (error) {
      const apiCode = error.response?.data?.code;
      setFounder(null);
      setFounderError(FOUNDER_ERRORS[apiCode] || error.response?.data?.error || "Não foi possível validar o convite de fundador.");
      // Código queimado ou vagas esgotadas não voltam a valer: descarta para
      // não reexibir o aviso a cada visita da sessão.
      if (apiCode === "FOUNDER_INVITE_USED" || apiCode === "FOUNDER_SLOTS_EXHAUSTED") {
        clearFounderCode();
      }
    }
  };

  useEffect(() => {
    fetchAll();
    checkFounderCode();
  }, []);

  const handleSubscribe = async (plan, { isFounderPlan = false } = {}) => {
    setBusyPlanId(plan.id);
    try {
      const payload = { planId: plan.id, billingType, isAnnual };
      // O backend exige o código para qualquer plano `isFounder` e rejeita a
      // assinatura sem ele (billingController.js).
      if (isFounderPlan) payload.founderInviteCode = founder.code;

      await api.post("/billing/subscribe", payload);
      toast.success("Assinatura criada! Finalize o pagamento para ativar os créditos.");

      if (isFounderPlan) {
        // Convite consumido: não deve reaparecer nas próximas telas.
        clearFounderCode();
        setFounder(null);
      }

      await fetchAll();
      await useAuthStore.getState().fetchBalance();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao assinar plano.");
      // Se o convite caiu entre a validação e o submit (outro convidado tomou
      // a última vaga), revalida para a tela refletir o estado real.
      if (isFounderPlan) await checkFounderCode();
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
    setBusyCancel(true);
    try {
      await api.post("/billing/subscription/cancel");
      toast.success("Assinatura cancelada.");
      setConfirmCancel(false);
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
      // O valor entra na mensagem porque o preço do avulso varia com o plano e
      // com o limite do ciclo — o cliente precisa ver quanto foi cobrado.
      const valor = data.pricing ? formatBRL(data.pricing.amountBrl) : "";

      // Recarrega ANTES de tentar abrir a cobrança: o card "Cobrança pendente"
      // passa a existir na tela, então há um caminho visível para o pagamento
      // mesmo se o popup for barrado.
      await fetchAll();

      // `window.open` depois de um `await` costuma ser bloqueado: o navegador
      // já considerou o gesto do usuário consumido e trata a chamada como popup
      // não solicitado. O cliente gerava a cobrança e a página de pagamento
      // simplesmente não abria, sem nenhum aviso.
      const aberta = data.invoiceUrl
        ? window.open(data.invoiceUrl, "_blank", "noopener,noreferrer")
        : null;

      toast.success(
        aberta || !data.invoiceUrl
          ? `Cobrança de ${valor} gerada! Finalize o pagamento para receber o crédito.`
          : `Cobrança de ${valor} gerada! Use o botão "Ver cobrança" abaixo para pagar — o navegador bloqueou a abertura automática.`,
        { duration: 8000 }
      );
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

      {/* Convite recusado: explica o motivo em vez de simplesmente omitir o
          plano, senão o convidado acha que o link está quebrado. */}
      {founderError && (
        <div className="glass rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-foreground text-sm">Convite de fundador</div>
            <p className="text-sm text-zinc-400 mt-0.5">{founderError}</p>
            <p className="text-xs text-zinc-500 mt-2">
              Os planos abaixo seguem disponíveis normalmente.
            </p>
          </div>
        </div>
      )}

      {founder && (
        <div className="glass rounded-2xl border-2 border-amber-500/40 bg-amber-500/[0.04] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-amber-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-500">
              Convite de fundador
            </span>
            <span className="text-xs text-zinc-500 font-mono ml-auto">{founder.code}</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div>
              <div className="text-xl font-bold text-foreground">{founder.plan.name}</div>
              <div className="text-3xl font-bold text-amber-500 mt-1">
                {formatBRL(founder.plan.priceBrl)}
                <span className="text-sm text-zinc-500 font-normal">/mês</span>
              </div>
              <div className="text-sm text-zinc-400 mt-2">
                {founder.plan.creditsMonthly} laudos/mês · preço travado por 12 meses
              </div>
              <div className="text-xs text-amber-500/80 mt-1">
                {founder.plan.founderSlotsRemaining} de {founder.plan.founderSlotsTotal} vagas restantes
              </div>
            </div>

            <div className="shrink-0">
              {subscription ? (
                // O backend recusa `subscribe` quando já existe assinatura, e o
                // upgrade não aceita código de fundador. Dizer isso é melhor que
                // oferecer um botão que vai falhar.
                <p className="text-sm text-zinc-500 max-w-xs">
                  Este convite vale apenas para contas sem assinatura. Cancele a
                  assinatura atual ou fale com o suporte para usá-lo.
                </p>
              ) : (
                <button
                  onClick={() => handleSubscribe(founder.plan, { isFounderPlan: true })}
                  disabled={busyPlanId === founder.plan.id}
                  className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50"
                >
                  {busyPlanId === founder.plan.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  Assinar como fundador
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
              onClick={() => setConfirmCancel(true)}
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
              {/* Espaçador: mantém os botões alinhados na base dos cards. */}
              <div className="mb-6 flex-1" />
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
            <div className="font-bold text-foreground flex items-center gap-2 flex-wrap">
              <span>Crédito avulso — {formatBRL(avulso ? avulso.price : 79)}</span>
              {avulso?.discounted && (
                <>
                  <span className="text-sm font-normal text-zinc-500 line-through">{formatBRL(avulso.fullPrice)}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    Preço de assinante
                  </span>
                </>
              )}
            </div>
            <div className="text-xs text-zinc-500">
              1 laudo, sem validade de expiração.
              {avulso?.discounted && (
                <> Restam {avulso.remaining} com desconto neste ciclo; depois volta a {formatBRL(avulso.fullPrice)}.</>
              )}
              {avulso && !avulso.discounted && avulso.limit > 0 && (
                <> Você já usou {avulso.used} de {avulso.limit} com desconto neste ciclo — o benefício volta na renovação.</>
              )}
            </div>
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

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar sua assinatura?"
        message="Os créditos mensais restantes serão perdidos ao final do ciclo. Créditos avulsos não expiram e continuam disponíveis."
        confirmLabel="Cancelar assinatura"
        cancelLabel="Manter assinatura"
        busy={busyCancel}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
