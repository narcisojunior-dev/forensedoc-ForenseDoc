import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A métrica que importa é TEMPO DE ESPERA, não profundidade.
 *
 * "10 jobs aguardando" não diz nada sozinho: dez análises com quatro workers
 * livres somem em segundos, dez paradas há quinze minutos são incidente. O que o
 * cliente sente, e o que antecede a reclamação, é há quanto tempo o job mais
 * antigo espera. Estes testes prendem essa escolha.
 */
function filaFalsa(nome, { waiting = 0, active = 0, failed = 0, esperaMs = 0, erro = null } = {}) {
  return {
    name: nome,
    getJobCounts: erro
      ? vi.fn().mockRejectedValue(new Error(erro))
      : vi.fn().mockResolvedValue({ waiting, active, delayed: 0, failed, completed: 0 }),
    getWaiting: vi
      .fn()
      .mockResolvedValue(esperaMs ? [{ timestamp: Date.now() - esperaMs }] : []),
    isPaused: vi.fn().mockResolvedValue(false),
  };
}

const filas = [];
vi.mock("../src/queues.js", () => ({ ALL_QUEUES: filas }));

async function metricas() {
  vi.resetModules();
  const mod = await import("../src/services/queueMetricsService.js");
  return mod;
}

function definirFilas(...novas) {
  filas.length = 0;
  filas.push(...novas);
}

beforeEach(() => {
  filas.length = 0;
});

describe("queueMetrics", () => {
  it("fila vazia é saudável", async () => {
    definirFilas(filaFalsa("forensedoc-analysis"));
    const { queueMetrics } = await metricas();
    const r = await queueMetrics();
    expect(r.saudavel).toBe(true);
    expect(r.filas[0].estado).toBe("OK");
    expect(r.filas[0].esperaMaisAntigaMs).toBe(0);
  });

  it("profundidade alta com espera curta NÃO é saturação", async () => {
    // O ponto de usar tempo em vez de contagem: 50 jobs que acabaram de chegar
    // e estão sendo consumidos não são incidente.
    definirFilas(filaFalsa("forensedoc-analysis", { waiting: 50, active: 4, esperaMs: 3_000 }));
    const { queueMetrics } = await metricas();
    const r = await queueMetrics();
    expect(r.filas[0].aguardando).toBe(50);
    expect(r.filas[0].saturada).toBe(false);
  });

  it("profundidade baixa com espera longa É saturação", async () => {
    // O inverso: 2 jobs parados há 10 minutos significa que nada está sendo
    // consumido, e é o caso que a contagem sozinha esconderia.
    definirFilas(filaFalsa("forensedoc-analysis", { waiting: 2, esperaMs: 10 * 60_000 }));
    const { queueMetrics } = await metricas();
    const r = await queueMetrics();
    expect(r.filas[0].saturada).toBe(true);
    expect(r.filas[0].estado).toBe("SATURADA");
    expect(r.saudavel).toBe(false);
    expect(r.saturadas).toContain("forensedoc-analysis");
  });

  it("pagamento tem limiar mais rigoroso que análise", async () => {
    // 90 segundos: normal para análise, grave para pagamento, porque é crédito
    // comprado e ainda não entregue.
    definirFilas(
      filaFalsa("forensedoc-analysis", { waiting: 1, esperaMs: 90_000 }),
      filaFalsa("forensedoc-payments", { waiting: 1, esperaMs: 90_000 })
    );
    const { queueMetrics } = await metricas();
    const r = await queueMetrics();
    const analise = r.filas.find((f) => f.fila === "forensedoc-analysis");
    const pagamento = r.filas.find((f) => f.fila === "forensedoc-payments");
    expect(analise.saturada).toBe(false);
    expect(pagamento.saturada).toBe(true);
  });

  it("uma fila indisponível não derruba as demais", async () => {
    // Redis instável não pode cegar o painel inteiro no momento em que ele é
    // mais necessário.
    definirFilas(
      filaFalsa("forensedoc-analysis", { erro: "ECONNREFUSED" }),
      filaFalsa("forensedoc-payments", { waiting: 1, esperaMs: 1_000 })
    );
    const { queueMetrics } = await metricas();
    const r = await queueMetrics();
    expect(r.indisponiveis).toEqual(["forensedoc-analysis"]);
    expect(r.filas.find((f) => f.fila === "forensedoc-payments").estado).toBe("OK");
  });

  it("jobs falhos aparecem mesmo sem saturação", async () => {
    definirFilas(filaFalsa("forensedoc-emails", { failed: 3 }));
    const { queueMetrics } = await metricas();
    const r = await queueMetrics();
    expect(r.filas[0].estado).toBe("COM_FALHAS");
    expect(r.saudavel).toBe(false);
  });
});

describe("checkQueueSaturation", () => {
  it("alerta uma vez só enquanto a fila continua cheia", async () => {
    // Sem isto o log recebe o mesmo alerta a cada minuto e vira ruído, que é
    // como um alerta deixa de ser lido.
    definirFilas(filaFalsa("forensedoc-analysis", { waiting: 5, esperaMs: 10 * 60_000 }));
    const { checkQueueSaturation } = await metricas();
    const emitir = vi.fn();

    await checkQueueSaturation(emitir);
    await checkQueueSaturation(emitir);
    await checkQueueSaturation(emitir);

    expect(emitir).toHaveBeenCalledTimes(1);
    expect(emitir.mock.calls[0][0]).toMatch(/SATURADA/);
  });

  it("avisa a normalização, e só de quem havia sido alertado", async () => {
    const cheia = filaFalsa("forensedoc-analysis", { waiting: 5, esperaMs: 10 * 60_000 });
    definirFilas(cheia);
    const { checkQueueSaturation } = await metricas();
    const emitir = vi.fn();

    await checkQueueSaturation(emitir);
    cheia.getWaiting.mockResolvedValue([]);
    cheia.getJobCounts.mockResolvedValue({
      waiting: 0, active: 0, delayed: 0, failed: 0, completed: 9,
    });
    await checkQueueSaturation(emitir);
    await checkQueueSaturation(emitir); // não repete o "voltou ao normal"

    expect(emitir).toHaveBeenCalledTimes(2);
    expect(emitir.mock.calls[1][0]).toMatch(/voltou ao normal/);
  });

  it("não alerta fila indisponível: o problema é o Redis, não a capacidade", async () => {
    definirFilas(filaFalsa("forensedoc-analysis", { erro: "ECONNREFUSED" }));
    const { checkQueueSaturation } = await metricas();
    const emitir = vi.fn();
    await checkQueueSaturation(emitir);
    expect(emitir).not.toHaveBeenCalled();
  });
});
