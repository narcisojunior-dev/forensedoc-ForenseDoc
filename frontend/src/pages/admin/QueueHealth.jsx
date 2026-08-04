import { useState, useEffect, useRef } from "react";
import { Loader2, Activity, AlertTriangle, CheckCircle2, PauseCircle } from "lucide-react";
import { api } from "../../lib/axios";

/**
 * Estado operacional das filas, no painel administrativo.
 *
 * ─── Por que tempo de espera vem antes da contagem ───────────────────────────
 *
 * "10 aguardando" não diz nada sozinho: dez análises com quatro workers livres
 * somem em segundos, dez paradas há quinze minutos são incidente. O que o
 * cliente sente é HÁ QUANTO TEMPO o job mais antigo espera, então é esse número
 * que ganha destaque visual. A contagem fica ao lado como contexto.
 *
 * A régua de saturação vem pronta do servidor (`saturada`), pelo mesmo motivo da
 * cadeia de custódia e da divergência geográfica: se a tela recalculasse, ela e
 * o alerta do worker acabariam discordando sobre o mesmo estado.
 */

const ROTULOS = {
  "forensedoc-analysis": "Análises",
  "forensedoc-payments": "Pagamentos",
  "forensedoc-emails": "E-mails",
  "forensedoc-crons": "Rotinas agendadas",
};

function duracao(ms) {
  if (!ms) return "sem espera";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function FilaCard({ f }) {
  if (f.estado === "INDISPONIVEL") {
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-500/[0.05] p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="text-[13px] font-semibold text-foreground">
            {ROTULOS[f.fila] || f.fila}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
          Não foi possível consultar esta fila ({f.erro}). O problema é a conexão com o Redis, não
          a capacidade de processamento.
        </p>
      </div>
    );
  }

  const tom = f.saturada
    ? { borda: "border-red-500/30", fundo: "bg-red-500/[0.05]", cor: "#ef4444", Icone: AlertTriangle }
    : f.falhos > 0
      ? { borda: "border-amber-500/30", fundo: "bg-amber-500/[0.05]", cor: "#f59e0b", Icone: AlertTriangle }
      : { borda: "border-surface-border", fundo: "bg-surface/30", cor: "#10b981", Icone: CheckCircle2 };

  return (
    <div className={`rounded-xl border p-4 ${tom.borda} ${tom.fundo}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <tom.Icone className="h-4 w-4 shrink-0" style={{ color: tom.cor }} />
          <span className="text-[13px] font-semibold text-foreground">
            {ROTULOS[f.fila] || f.fila}
          </span>
          {f.pausada && (
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500">
              <PauseCircle className="h-3 w-3" /> pausada
            </span>
          )}
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: tom.cor }}
        >
          {f.saturada ? "saturada" : f.falhos > 0 ? "com falhas" : "ok"}
        </span>
      </div>

      {/* O número grande é a ESPERA, não a contagem: é o que antecede a reclamação. */}
      <div className="mt-3">
        <div className="text-[11px] text-zinc-500">Espera do job mais antigo</div>
        <div className="text-xl font-bold tabular-nums" style={{ color: tom.cor }}>
          {duracao(f.esperaMaisAntigaMs)}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          limite de alerta: {duracao(f.limiteEsperaMs)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-surface-border pt-2.5">
        {[
          ["Aguardando", f.aguardando],
          ["Processando", f.processando],
          ["Falhos", f.falhos],
        ].map(([rotulo, valor]) => (
          <div key={rotulo}>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">{rotulo}</div>
            <div
              className={`text-[15px] font-bold tabular-nums ${
                rotulo === "Falhos" && valor > 0 ? "text-amber-500" : "text-foreground"
              }`}
            >
              {valor}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QueueHealth() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;

    async function buscar() {
      try {
        const { data } = await api.get("/admin/queues");
        if (montado.current) {
          setDados(data);
          setErro(false);
        }
      } catch {
        if (montado.current) setErro(true);
      } finally {
        if (montado.current) setCarregando(false);
      }
    }

    buscar();
    // Estado de fila só é útil se for recente: uma leitura de cinco minutos
    // atrás não distingue "está saturada agora" de "esteve saturada".
    const timer = setInterval(buscar, 15_000);

    return () => {
      montado.current = false;
      clearInterval(timer);
    };
  }, []);

  if (carregando) {
    return (
      <div className="py-10 flex justify-center">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <div className="glass rounded-xl border border-surface-border p-5">
        <span className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Filas de processamento
        </span>
        <p className="mt-2 text-[13px] text-zinc-500">
          Não foi possível consultar as filas. Verifique se o Redis está acessível.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl border border-surface-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Filas de processamento
        </span>
        <span
          className={`text-[11px] font-bold uppercase tracking-wider ${
            dados.saudavel ? "text-emerald-500" : "text-amber-500"
          }`}
        >
          {dados.saudavel ? "tudo normal" : "requer atenção"}
        </span>
      </div>

      {dados.saturadas?.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/[0.05] px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-zinc-300">
            <b className="text-red-400">Capacidade insuficiente.</b> Jobs estão esperando acima do
            limite aceitável. Aumente a concorrência da fila
            (<code className="text-[11px]">WORKER_CONCURRENCY_*</code>) ou o número de réplicas do
            worker (<code className="text-[11px]">WORKER_REPLICAS</code>).
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {dados.filas.map((f) => (
          <FilaCard key={f.fila} f={f} />
        ))}
      </div>

      <p className="mt-3 text-[11px] text-zinc-500">
        Atualiza a cada 15 segundos. O worker também registra alerta no log quando uma fila
        ultrapassa o limite, para o aviso não depender de alguém estar com esta tela aberta.
      </p>
    </div>
  );
}
