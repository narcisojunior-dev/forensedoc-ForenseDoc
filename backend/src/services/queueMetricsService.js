import { ALL_QUEUES } from "../queues.js";

/**
 * Métricas operacionais das filas.
 *
 * ─── Por que profundidade não basta ──────────────────────────────────────────
 *
 * "10 jobs aguardando" não diz nada sozinho. Dez análises na fila com quatro
 * workers livres é normal e some em segundos; dez análises paradas há quinze
 * minutos é incidente. O sinal que importa é **há quanto tempo o job mais antigo
 * espera**, porque é isso que o cliente sente e é isso que antecede a
 * reclamação.
 *
 * Por isso cada fila reporta `esperaMaisAntigaMs` junto das contagens. É a
 * métrica sobre a qual o alerta deve ser montado, não a profundidade.
 *
 * ─── Limiares ────────────────────────────────────────────────────────────────
 *
 * Cada fila tem o seu, porque o que é aceitável difere por natureza do trabalho:
 * um pagamento parado há 1 minuto já é grave, já que é crédito comprado e não
 * entregue, enquanto uma análise esperando 2 minutos em horário de pico é
 * apenas fila normal.
 */
const LIMIARES_MS = {
  "forensedoc-analysis": Number(process.env.ALERT_WAIT_ANALYSIS_MS) || 5 * 60_000,
  "forensedoc-payments": Number(process.env.ALERT_WAIT_PAYMENTS_MS) || 60_000,
  "forensedoc-emails": Number(process.env.ALERT_WAIT_EMAILS_MS) || 10 * 60_000,
  "forensedoc-crons": Number(process.env.ALERT_WAIT_CRONS_MS) || 30 * 60_000,
};

/** Idade do job aguardando há mais tempo. É o sinal, não a contagem. */
async function esperaMaisAntigaMs(fila) {
  // `getWaiting(0, 0)` traz só o primeiro da fila, que por ser FIFO é o mais
  // antigo. Buscar a fila inteira para calcular isto seria caro justamente no
  // momento em que ela está grande, que é quando a métrica é consultada.
  const [primeiro] = await fila.getWaiting(0, 0);
  if (!primeiro) return 0;
  return Math.max(0, Date.now() - primeiro.timestamp);
}

/**
 * Estado de uma fila: contagens, espera do job mais antigo e veredito.
 *
 * O veredito é calculado aqui, no servidor, para que o alerta externo e a tela
 * de administração não implementem cada um a sua régua e discordem sobre o
 * mesmo estado.
 */
async function estadoDaFila(fila) {
  const [contagem, esperaMs] = await Promise.all([
    fila.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
    esperaMaisAntigaMs(fila),
  ]);

  const limiteMs = LIMIARES_MS[fila.name] ?? 5 * 60_000;
  const saturada = esperaMs > limiteMs;

  return {
    fila: fila.name,
    aguardando: contagem.waiting,
    processando: contagem.active,
    agendados: contagem.delayed,
    falhos: contagem.failed,
    concluidos: contagem.completed,
    esperaMaisAntigaMs: esperaMs,
    limiteEsperaMs: limiteMs,
    saturada,
    estado: saturada ? "SATURADA" : contagem.failed > 0 ? "COM_FALHAS" : "OK",
  };
}

/**
 * Snapshot de todas as filas.
 *
 * `paused` é consultado à parte porque uma fila pausada tem profundidade
 * crescente sem que nada esteja errado com a capacidade, e confundir os dois
 * casos leva a aumentar worker quando o problema é outro.
 */
export async function queueMetrics() {
  const filas = await Promise.all(
    ALL_QUEUES.map(async (fila) => {
      try {
        const estado = await estadoDaFila(fila);
        const pausada = await fila.isPaused().catch(() => false);
        return { ...estado, pausada };
      } catch (err) {
        // Redis fora do ar não pode derrubar a tela de administração inteira:
        // a fila que falhou reporta o próprio erro e as outras seguem.
        return { fila: fila.name, estado: "INDISPONIVEL", erro: err.message };
      }
    })
  );

  return {
    filas,
    // Resumo para quem lê em diagonal ou monta alerta sem interpretar a lista.
    saudavel: filas.every((f) => f.estado === "OK"),
    saturadas: filas.filter((f) => f.saturada).map((f) => f.fila),
    indisponiveis: filas.filter((f) => f.estado === "INDISPONIVEL").map((f) => f.fila),
    geradoEm: new Date().toISOString(),
  };
}

/*
 * ─── Vigilância periódica ────────────────────────────────────────────────────
 *
 * O endpoint só responde a quem pergunta, e ninguém abre o painel de madrugada.
 * A verificação periódica é o que transforma a métrica em aviso: sem ela, a
 * saturação continua sendo descoberta pela reclamação do cliente, que é
 * exatamente o problema que estas métricas existem para resolver.
 *
 * Roda no processo do WORKER, não na API. A API pode ter várias instâncias atrás
 * do balanceador, e cada uma emitiria o mesmo alerta.
 */
const INTERVALO_VIGIA_MS = Number(process.env.QUEUE_WATCH_INTERVAL_MS) || 60_000;

/** Evita repetir o mesmo alerta a cada minuto enquanto a fila continua cheia. */
const alertadas = new Set();

export async function checkQueueSaturation(emitir = console.warn) {
  const { filas } = await queueMetrics();

  for (const f of filas) {
    if (f.estado === "INDISPONIVEL") continue;

    if (f.saturada && !alertadas.has(f.fila)) {
      alertadas.add(f.fila);
      emitir(
        `[QueueAlert] Fila '${f.fila}' SATURADA: ${f.aguardando} job(s) aguardando, ` +
          `o mais antigo há ${Math.round(f.esperaMaisAntigaMs / 1000)}s ` +
          `(limite ${Math.round(f.limiteEsperaMs / 1000)}s). ` +
          `Aumente a concorrência da fila ou o número de réplicas do worker.`
      );
    }

    // Só avisa a normalização de quem já havia sido alertado, senão o log
    // enche de "voltou ao normal" para filas que nunca saíram dele.
    if (!f.saturada && alertadas.has(f.fila)) {
      alertadas.delete(f.fila);
      emitir(`[QueueAlert] Fila '${f.fila}' voltou ao normal.`);
    }
  }

  return filas;
}

export function startQueueWatch(emitir = console.warn) {
  const timer = setInterval(() => {
    checkQueueSaturation(emitir).catch((err) =>
      console.error("[QueueAlert] Falha ao verificar filas:", err.message)
    );
  }, INTERVALO_VIGIA_MS);

  // Sem `unref`, este timer sozinho segura o processo vivo e o encerramento
  // ordenado do worker nunca completa.
  timer.unref();
  return timer;
}
