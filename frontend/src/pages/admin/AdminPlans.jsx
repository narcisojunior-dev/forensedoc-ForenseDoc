import { useState, useEffect } from "react";
import { Loader2, Pencil, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/axios";

/** Valores do formulário derivados do plano — fonte única para abrir e cancelar. */
function formFromPlan(plan) {
  return {
    priceBrl: Number(plan.priceBrl),
    creditsMonthly: plan.creditsMonthly,
    maxUsers: plan.maxUsers,
    // Campo vazio = sem desconto de avulso para este plano.
    avulsoPriceBrl: plan.avulsoPriceBrl == null ? "" : Number(plan.avulsoPriceBrl),
    avulsoDiscountLimit: plan.avulsoDiscountLimit,
    isActive: plan.isActive,
  };
}

function PlanRow({ plan, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => formFromPlan(plan));

  /** Abre a edição sempre a partir do plano atual, nunca do rascunho anterior. */
  const startEditing = () => {
    setForm(formFromPlan(plan));
    setEditing(true);
  };

  /**
   * Cancelar precisa DESCARTAR o rascunho. O `useState` só usa o valor inicial
   * na primeira montagem, e a linha não é remontada entre edições (a `key` é o
   * id do plano) — sem restaurar aqui, reabrir a edição trazia de volta o que o
   * operador tinha digitado e abandonado.
   */
  const cancelEditing = () => {
    setForm(formFromPlan(plan));
    setEditing(false);
  };

  const save = async () => {
    // `Number("")` é 0: um campo de preço apagado por engano salvava o plano a
    // R$ 0,00 sem nenhum aviso. O backend aceita (`nonnegative`), então a
    // proteção tem de estar aqui.
    const obrigatorios = [
      ["Preço/mês", form.priceBrl],
      ["Créditos", form.creditsMonthly],
      ["Usuários", form.maxUsers],
      ["Limite/ciclo", form.avulsoDiscountLimit],
    ];
    const vazio = obrigatorios.find(([, v]) => v === "" || v === null || v === undefined);
    if (vazio) return toast.error(`Preencha o campo "${vazio[0]}".`);

    setSaving(true);
    try {
      const { data } = await api.patch(`/admin/plans/${plan.id}`, {
        priceBrl: Number(form.priceBrl),
        creditsMonthly: Number(form.creditsMonthly),
        maxUsers: Number(form.maxUsers),
        avulsoPriceBrl: form.avulsoPriceBrl === "" ? null : Number(form.avulsoPriceBrl),
        avulsoDiscountLimit: Number(form.avulsoDiscountLimit),
        isActive: form.isActive,
      });
      toast.success(`Plano ${data.plan.name} atualizado.`);
      setEditing(false);
      onSaved();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao salvar o plano.");
    } finally {
      setSaving(false);
    }
  };

  const cell = "px-4 py-3";
  const input =
    "w-24 px-2 py-1 bg-background border border-surface-border rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  if (!editing) {
    return (
      <tr className="border-b border-surface-border/50 last:border-0">
        <td className={cell}>
          <p className="font-medium text-foreground">{plan.name}</p>
          <p className="text-xs text-zinc-500">{plan.slug}{plan.isFounder ? " · fundador" : ""}</p>
        </td>
        <td className={`${cell} text-right`}>R$ {Number(plan.priceBrl).toFixed(2)}</td>
        <td className={`${cell} text-right`}>{plan.creditsMonthly}</td>
        <td className={`${cell} text-right`}>{plan.maxUsers}</td>
        <td className={`${cell} text-right`}>
          {plan.avulsoPriceBrl == null ? (
            <span className="text-zinc-600">—</span>
          ) : (
            <span className="text-foreground">R$ {Number(plan.avulsoPriceBrl).toFixed(2)}</span>
          )}
        </td>
        <td className={`${cell} text-right`}>
          <span className={plan.avulsoDiscountLimit > 0 ? "text-zinc-400" : "text-zinc-600"}>
            {plan.avulsoDiscountLimit}
          </span>
        </td>
        <td className={`${cell} text-center`}>
          <span className={plan.isActive ? "text-emerald-400" : "text-zinc-500"}>
            {plan.isActive ? "Ativo" : "Inativo"}
          </span>
        </td>
        <td className={`${cell} text-right text-zinc-400`}>{plan.activeSubscriptions}</td>
        <td className={`${cell} text-right`}>
          <button onClick={startEditing} className="text-zinc-400 hover:text-primary p-1" title="Editar">
            <Pencil className="w-4 h-4" />
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-surface-border/50 last:border-0 bg-primary/[0.03]">
      <td className={cell}>
        <p className="font-medium text-foreground">{plan.name}</p>
      </td>
      <td className={`${cell} text-right`}>
        <input type="number" step="0.01" className={input} value={form.priceBrl} onChange={(e) => setForm({ ...form, priceBrl: e.target.value })} />
      </td>
      <td className={`${cell} text-right`}>
        <input type="number" className={input} value={form.creditsMonthly} onChange={(e) => setForm({ ...form, creditsMonthly: e.target.value })} />
      </td>
      <td className={`${cell} text-right`}>
        <input type="number" className={input} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} />
      </td>
      <td className={`${cell} text-right`}>
        <input
          type="number"
          step="0.01"
          placeholder="sem desconto"
          title="Preço do laudo avulso para quem já assina este plano. Vazio = paga o preço cheio."
          className={input}
          value={form.avulsoPriceBrl}
          onChange={(e) => setForm({ ...form, avulsoPriceBrl: e.target.value })}
        />
      </td>
      <td className={`${cell} text-right`}>
        <input
          type="number"
          min="0"
          title="Quantos avulsos com desconto o assinante pode comprar por ciclo. 0 desliga o benefício."
          className={input}
          value={form.avulsoDiscountLimit}
          onChange={(e) => setForm({ ...form, avulsoDiscountLimit: e.target.value })}
        />
      </td>
      <td className={`${cell} text-center`}>
        <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
      </td>
      <td className={`${cell} text-right text-zinc-400`}>{plan.activeSubscriptions}</td>
      <td className={`${cell} text-right whitespace-nowrap`}>
        <button onClick={save} disabled={saving} className="text-emerald-400 hover:text-emerald-300 p-1 disabled:opacity-50" title="Salvar">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button onClick={cancelEditing} disabled={saving} className="text-zinc-400 hover:text-foreground p-1" title="Cancelar">
          <X className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

export default function AdminPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get("/admin/plans")
      .then((r) => setPlans(r.data.plans))
      .catch(() => toast.error("Erro ao carregar planos."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="glass rounded-2xl border border-surface-border overflow-hidden">
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left">
                <th className="px-4 py-3 font-medium text-zinc-400">Plano</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right">Preço/mês</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right">Créditos</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right">Usuários</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right" title="Preço do laudo avulso para quem já assina este plano">
                  Avulso assinante
                </th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right" title="Quantos avulsos com desconto por ciclo de faturamento">
                  Limite/ciclo
                </th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-center">Status</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-right">Assinantes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={load} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
