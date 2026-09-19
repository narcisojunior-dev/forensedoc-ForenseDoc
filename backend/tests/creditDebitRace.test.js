import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * B1 da auditoria de 19/09/2026 — corrida no débito de crédito.
 *
 * `debitCredit` lia o saldo, decidia o campo num `if` e só então decrementava.
 * Entre a leitura e a escrita havia uma janela: duas análises do mesmo tenant
 * entrando juntas liam saldo 1, as duas passavam pela checagem e as duas
 * decrementavam. Dois laudos por um crédito, saldo em -1.
 *
 * O que segurava isso era o semáforo `maxConcurrentAnalyses`, externo a esta
 * função e com default 1 — mas ele é atributo comercial, elevado por
 * `PATCH /admin/plans/:id` sem deploy. Estes testes existem para que a correção
 * do débito não volte a depender dele.
 */

const creditBalance = { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() };
const creditTransaction = { create: vi.fn(async () => ({ id: "ctx" })) };
const auditLog = { create: vi.fn(async () => ({})) };

vi.mock("../src/utils/prisma.js", () => ({
  prisma: { creditBalance, creditTransaction, auditLog },
}));
vi.mock("../src/utils/redis.js", () => ({
  redis: { get: vi.fn(async () => null), setex: vi.fn(), del: vi.fn() },
}));
vi.mock("../src/services/notificationService.js", () => ({ notify: vi.fn() }));

const { debitCredit } = await import("../src/services/creditService.js");

/**
 * Banco de mentira que se comporta como o real no ponto que importa: o
 * `updateMany` só altera a linha se a condição do WHERE bater NO MOMENTO da
 * escrita. É isso que torna o decremento atômico.
 */
function bancoFalso(saldoInicial) {
  const saldo = { tenantId: "t1", creditsMonthly: 0, creditsEmergency: 0, creditsAvulso: 0, creditsManual: 0, ...saldoInicial };

  creditBalance.findUnique.mockImplementation(async () => ({ ...saldo }));
  creditBalance.updateMany.mockImplementation(async ({ where, data }) => {
    const campo = Object.keys(data)[0];
    const minimo = where[campo]?.gt;
    // Sem a condição no WHERE, o UPDATE não é condicional e a corrida volta.
    if (minimo === undefined) throw new Error("updateMany sem condição no WHERE");
    if (!(saldo[campo] > minimo)) return { count: 0 };
    saldo[campo] -= 1;
    return { count: 1 };
  });
  // O `update` incondicional não pode mais ser usado para debitar.
  creditBalance.update.mockImplementation(async () => {
    throw new Error("debitCredit não deve usar update incondicional");
  });

  return saldo;
}

beforeEach(() => vi.clearAllMocks());

describe("debitCredit sob concorrência", () => {
  it("dois débitos simultâneos sobre 1 crédito: só um passa, e o saldo não fica negativo", async () => {
    const saldo = bancoFalso({ creditsMonthly: 1 });

    const resultados = await Promise.allSettled([
      debitCredit("t1", "u1", "a1"),
      debitCredit("t1", "u2", "a2"),
    ]);

    const aceitos = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r) => r.status === "rejected");

    expect(aceitos).toHaveLength(1);
    expect(recusados).toHaveLength(1);
    expect(recusados[0].reason.message).toBe("INSUFFICIENT_CREDITS");
    expect(saldo.creditsMonthly).toBe(0);
  });

  it("cinco débitos simultâneos sobre 3 créditos: passam exatamente 3", async () => {
    const saldo = bancoFalso({ creditsMonthly: 3 });

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => debitCredit("t1", `u${i}`, `a${i}`))
    );

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(saldo.creditsMonthly).toBe(0);
  });

  it("o saldo nunca fica negativo, que é o que a constraint do banco reforça", async () => {
    const saldo = bancoFalso({ creditsMonthly: 2 });
    await Promise.allSettled(Array.from({ length: 8 }, () => debitCredit("t1", "u1", "a1")));

    for (const campo of ["creditsMonthly", "creditsEmergency", "creditsAvulso", "creditsManual"]) {
      expect(saldo[campo]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("debitCredit preserva a ordem de prioridade de gasto", () => {
  it("gasta o mensal antes do avulso", async () => {
    const saldo = bancoFalso({ creditsMonthly: 1, creditsAvulso: 5 });
    const { creditTx } = await debitCredit("t1", "u1", "a1");

    expect(saldo.creditsMonthly).toBe(0);
    expect(saldo.creditsAvulso).toBe(5);
    expect(creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creditType: "monthly" }) })
    );
    expect(creditTx).toBeTruthy();
  });

  it("segue a ordem mensal -> emergência -> avulso -> manual", async () => {
    const saldo = bancoFalso({ creditsEmergency: 1, creditsAvulso: 1, creditsManual: 1 });

    await debitCredit("t1", "u1", "a1");
    expect(saldo.creditsEmergency).toBe(0);

    await debitCredit("t1", "u1", "a2");
    expect(saldo.creditsAvulso).toBe(0);

    await debitCredit("t1", "u1", "a3");
    expect(saldo.creditsManual).toBe(0);
  });

  it("perder a corrida no mensal cai para o avulso, e não devolve 402 indevido", async () => {
    // Quem tem 1 mensal e 5 avulsos não pode receber "sem saldo" só porque
    // outra análise levou o mensal no mesmo instante.
    const saldo = bancoFalso({ creditsMonthly: 1, creditsAvulso: 5 });

    const resultados = await Promise.allSettled([
      debitCredit("t1", "u1", "a1"),
      debitCredit("t1", "u2", "a2"),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(saldo.creditsMonthly).toBe(0);
    expect(saldo.creditsAvulso).toBe(4);
  });
});

describe("debitCredit sem saldo", () => {
  it("recusa com INSUFFICIENT_CREDITS e não cria transação", async () => {
    bancoFalso({});
    await expect(debitCredit("t1", "u1", "a1")).rejects.toThrow("INSUFFICIENT_CREDITS");
    expect(creditTransaction.create).not.toHaveBeenCalled();
  });
});
