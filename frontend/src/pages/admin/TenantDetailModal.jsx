import { useState, useEffect } from "react";
import { X, Loader2, Zap, Ban, CheckCircle2, Mail, FileText } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/axios";
import { StatusBadge } from "./AdminTenants";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatMoney(value) {
  if (value === null || value === undefined) return "—";
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{children}</p>
    </div>
  );
}

export default function TenantDetailModal({ tenantId, onClose, onChanged }) {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const [creditAmount, setCreditAmount] = useState("");
  const [creditNotes, setCreditNotes] = useState("");
  const [granting, setGranting] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/admin/tenants/${tenantId}`);
      setTenant(data.tenant);
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao carregar a conta.");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleGrantCredits = async (e) => {
    e.preventDefault();
    const amount = parseInt(creditAmount, 10);
    if (!Number.isInteger(amount) || amount === 0) {
      return toast.error("Informe uma quantidade diferente de zero.");
    }
    if (creditNotes.trim().length < 3) {
      return toast.error("Descreva o motivo da concessão.");
    }

    setGranting(true);
    try {
      await api.post(`/admin/tenants/${tenantId}/credits`, { amount, notes: creditNotes.trim() });
      toast.success(
        amount > 0 ? `${amount} crédito(s) adicionado(s).` : `${Math.abs(amount)} crédito(s) removido(s).`
      );
      setCreditAmount("");
      setCreditNotes("");
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao lançar créditos.");
    } finally {
      setGranting(false);
    }
  };

  const handleSuspend = async () => {
    const reason = window.prompt("Motivo da suspensão (fica registrado na auditoria e é enviado ao cliente):");
    if (reason === null) return;
    if (reason.trim().length < 3) return toast.error("Informe um motivo válido.");

    setStatusChanging(true);
    try {
      await api.post(`/admin/tenants/${tenantId}/suspend`, { reason: reason.trim() });
      toast.success("Conta suspensa. As sessões ativas foram encerradas.");
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao suspender a conta.");
    } finally {
      setStatusChanging(false);
    }
  };

  const handleActivate = async () => {
    setStatusChanging(true);
    try {
      const { data } = await api.post(`/admin/tenants/${tenantId}/activate`);
      toast.success(`Conta reativada (${data.status}).`);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao reativar a conta.");
    } finally {
      setStatusChanging(false);
    }
  };

  const balance = tenant?.creditBalance;
  const totalCredits = balance
    ? balance.creditsMonthly + balance.creditsAvulso + balance.creditsEmergency + balance.creditsManual
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-surface-border rounded-2xl w-full max-w-2xl my-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="py-24 flex justify-center">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between p-6 border-b border-surface-border">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-lg font-bold text-foreground">{tenant.name}</h2>
                  <StatusBadge status={tenant.status} />
                </div>
                <p className="text-xs text-zinc-500">
                  {tenant.cpfCnpj} · cadastro em {formatDate(tenant.createdAt)}
                </p>
              </div>
              <button onClick={onClose} className="text-zinc-400 hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Plano">{tenant.subscription?.plan?.name || "Sem assinatura"}</Field>
                <Field label="Mensalidade">
                  {formatMoney(tenant.subscription?.plan?.priceBrl)}
                </Field>
                <Field label="Renova em">{formatDate(tenant.subscription?.currentPeriodEnd)}</Field>
                <Field label="Laudos gerados">{tenant._count?.analyses ?? 0}</Field>
              </div>

              {/* Créditos */}
              <div className="bg-background/50 border border-surface-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-accent" /> Saldo de créditos
                  </span>
                  <span className="text-xl font-bold text-foreground">{totalCredits}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ["Mensal", balance?.creditsMonthly],
                    ["Avulso", balance?.creditsAvulso],
                    ["Emergência", balance?.creditsEmergency],
                    ["Manual", balance?.creditsManual],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-surface rounded-lg py-2">
                      <p className="text-sm font-bold text-foreground">{value ?? 0}</p>
                      <p className="text-[10px] text-zinc-500">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lançar créditos */}
              <form onSubmit={handleGrantCredits} className="space-y-3">
                <p className="text-sm font-medium text-zinc-300">Lançar créditos manuais</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="number"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    placeholder="Qtd."
                    className="sm:w-28 px-4 py-2.5 bg-background border border-surface-border rounded-lg text-sm text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <input
                    value={creditNotes}
                    onChange={(e) => setCreditNotes(e.target.value)}
                    placeholder="Motivo (registrado na auditoria)"
                    className="flex-1 px-4 py-2.5 bg-background border border-surface-border rounded-lg text-sm text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="submit"
                    disabled={granting}
                    className="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-primary hover:bg-blue-600 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {granting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lançar"}
                  </button>
                </div>
                <p className="text-xs text-zinc-500">
                  Valores negativos estornam uma concessão anterior.
                </p>
              </form>

              {/* Membros */}
              <div>
                <p className="text-sm font-medium text-zinc-300 mb-2">
                  Membros ({tenant.users.length})
                </p>
                <div className="space-y-1.5">
                  {tenant.users.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between bg-background/50 border border-surface-border rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">
                          {u.name}{" "}
                          <span className="text-xs text-zinc-500">
                            ({u.role === "OWNER" ? "Titular" : "Membro"})
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500 truncate flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {u.email}
                        </p>
                      </div>
                      {!u.emailVerified && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
                          e-mail não confirmado
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Últimos pagamentos */}
              {tenant.payments?.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Últimos pagamentos
                  </p>
                  <div className="space-y-1">
                    {tenant.payments.slice(0, 5).map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs px-3 py-2 bg-background/50 rounded-lg"
                      >
                        <span className="text-zinc-400">{formatDate(p.createdAt)}</span>
                        <span className="text-foreground">{formatMoney(p.amountBrl)}</span>
                        <span
                          className={
                            p.status === "PAID"
                              ? "text-emerald-400"
                              : p.status === "OVERDUE"
                                ? "text-red-400"
                                : "text-zinc-400"
                          }
                        >
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ações destrutivas ficam separadas do resto */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-surface-border">
              {tenant.status === "SUSPENDED" ? (
                <button
                  onClick={handleActivate}
                  disabled={statusChanging}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                >
                  {statusChanging ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Reativar conta
                </button>
              ) : (
                <button
                  onClick={handleSuspend}
                  disabled={statusChanging}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                >
                  {statusChanging ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Ban className="w-4 h-4" />
                  )}
                  Suspender conta
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
