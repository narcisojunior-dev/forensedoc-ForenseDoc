import { useState, useEffect } from "react";
import { Loader2, Copy, Check, Ticket, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/axios";
import { cn } from "../../utils/cn";
import { buildFounderLink } from "../../utils/founderInvite";

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function StatCard({ label, value, tone = "text-foreground" }) {
  return (
    <div className="glass rounded-xl border border-surface-border p-4">
      <p className={cn("text-2xl font-bold", tone)}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function AdminFounders() {
  const [invites, setInvites] = useState([]);
  const [slots, setSlots] = useState({ total: 0, remaining: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/founder-invites");
      setInvites(data.invites);
      setSlots(data.slots);
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao carregar convites.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const payload = { quantity: Number(quantity) };
      // O e-mail só faz sentido quando o convite é nominal (um por vez).
      if (Number(quantity) === 1 && email.trim()) payload.email = email.trim();

      const { data } = await api.post("/admin/founder-invites", payload);
      toast.success(
        data.invites.length === 1
          ? `Convite ${data.invites[0].code} gerado.`
          : `${data.invites.length} convites gerados.`
      );
      setEmail("");
      setQuantity(1);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao gerar convites.");
    } finally {
      setGenerating(false);
    }
  };

  // Copia o link completo, não o código solto: o convidado abre e cai direto
  // no card de fundador já validado, sem digitar nada.
  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(buildFounderLink(code));
      setCopiedCode(code);
      toast.success("Link do convite copiado.");
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o link manualmente.");
    }
  };

  const used = invites.filter((i) => i.usedAt).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Vagas totais" value={slots.total} />
        <StatCard label="Vagas restantes" value={slots.remaining} tone="text-primary" />
        <StatCard label="Convites pendentes" value={slots.pending} tone="text-amber-500" />
        <StatCard label="Resgatados" value={used} tone="text-emerald-500" />
      </div>

      <form onSubmit={handleGenerate} className="glass rounded-2xl border border-surface-border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">Gerar convites</h2>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="sm:w-32">
            <label className="block text-xs text-zinc-500 mb-1">Quantidade</label>
            <input
              type="number"
              min="1"
              max="25"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-surface-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-zinc-500 mb-1">
              E-mail do convidado (opcional, só para convite único)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={Number(quantity) !== 1}
              placeholder="advogado@escritorio.com.br"
              className="w-full px-4 py-2.5 bg-background border border-surface-border rounded-lg text-sm text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={generating || slots.remaining === 0}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-bold text-white bg-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Gerar"}
            </button>
          </div>
        </div>

        <p className="text-xs text-zinc-500">
          Envie ao convidado o <strong>link</strong> gerado abaixo (clique no código para copiá-lo):
          ele abre direto no plano Fundador já validado. Cada código vale uma vez e trava o preço
          por 12 meses. O convite só pode ser usado por conta sem assinatura.
        </p>
      </form>

      <div className="glass rounded-2xl border border-surface-border overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : invites.length === 0 ? (
          <div className="py-16 text-center">
            <Ticket className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
            <p className="text-sm text-zinc-500">Nenhum convite gerado ainda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left">
                  <th className="px-4 py-3 font-medium text-zinc-400">Código</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Destinatário</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Situação</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Gerado em</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr
                    key={invite.code}
                    className="border-b border-surface-border/50 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => copyCode(invite.code)}
                        disabled={!!invite.usedAt}
                        className="flex items-center gap-2 font-mono text-foreground hover:text-primary disabled:hover:text-foreground disabled:cursor-default transition-colors"
                        title={invite.usedAt ? "Convite já utilizado" : "Copiar link do convite"}
                      >
                        {invite.code}
                        {!invite.usedAt &&
                          (copiedCode === invite.code ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 opacity-50" />
                          ))}
                      </button>
                      {!invite.usedAt && (
                        <p className="text-[11px] text-zinc-600 mt-1 font-mono break-all max-w-xs">
                          {buildFounderLink(invite.code)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{invite.email || "—"}</td>
                    <td className="px-4 py-3">
                      {invite.usedAt ? (
                        <span className="text-xs text-emerald-400">
                          Resgatado por {invite.usedBy} em {formatDate(invite.usedAt)}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Disponível
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {formatDate(invite.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
