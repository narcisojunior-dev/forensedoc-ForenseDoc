import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mutex e janela fixa viraram atributo do plano.
 *
 * Os dois eram constantes calibradas para escritório com um operador só. Num
 * cliente B2B com dez funcionários, os dez disputavam um slot único e o teto de
 * 120 laudos por hora valia independentemente da infraestrutura.
 *
 * O ponto sensível da migração é o default: quem já assina não pode perceber
 * mudança nenhuma até o plano dele ser ajustado.
 */
const loja = new Map();
const redisFalso = {
  get: vi.fn(async (k) => loja.get(k) ?? null),
  setex: vi.fn(async (k, _t, v) => loja.set(k, v)),
  del: vi.fn(async (k) => loja.delete(k)),
};
const prismaFalso = { subscription: { findUnique: vi.fn() } };

vi.mock("../src/utils/redis.js", () => ({ redis: redisFalso }));
vi.mock("../src/utils/prisma.js", () => ({ prisma: prismaFalso }));

const { getPlanLimits, invalidatePlanLimits } = await import(
  "../src/services/planLimitsService.js"
);

beforeEach(() => {
  loja.clear();
  vi.clearAllMocks();
  redisFalso.get.mockImplementation(async (k) => loja.get(k) ?? null);
  redisFalso.setex.mockImplementation(async (k, _t, v) => loja.set(k, v));
});

describe("getPlanLimits", () => {
  it("o default reproduz o comportamento anterior à mudança", async () => {
    // Mutex de 1 análise por vez e janela de 30s, que é 2 por minuto.
    prismaFalso.subscription.findUnique.mockResolvedValue(null);
    expect(await getPlanLimits("t1")).toEqual({
      maxConcurrentAnalyses: 1,
      analysesPerMinute: 2,
    });
  });

  it("assinatura ativa concede a capacidade do plano", async () => {
    prismaFalso.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      plan: { maxConcurrentAnalyses: 8, analysesPerMinute: 40 },
    });
    expect(await getPlanLimits("t1")).toEqual({
      maxConcurrentAnalyses: 8,
      analysesPerMinute: 40,
    });
  });

  it("assinatura suspensa NÃO mantém a capacidade contratada", async () => {
    // Quem parou de pagar volta ao padrão, em vez de seguir com o teto do plano.
    prismaFalso.subscription.findUnique.mockResolvedValue({
      status: "SUSPENDED",
      plan: { maxConcurrentAnalyses: 8, analysesPerMinute: 40 },
    });
    expect(await getPlanLimits("t1")).toEqual({
      maxConcurrentAnalyses: 1,
      analysesPerMinute: 2,
    });
  });

  it("falha do banco cai no padrão, não em capacidade ilimitada", async () => {
    // Fail-safe pelo lado restritivo: aqui errar para cima é entregar
    // capacidade que talvez não tenha sido comprada.
    prismaFalso.subscription.findUnique.mockRejectedValue(new Error("timeout"));
    expect(await getPlanLimits("t1")).toEqual({
      maxConcurrentAnalyses: 1,
      analysesPerMinute: 2,
    });
  });

  it("nunca devolve limite abaixo de 1", async () => {
    // Um zero gravado por engano no plano bloquearia o cliente por completo.
    prismaFalso.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      plan: { maxConcurrentAnalyses: 0, analysesPerMinute: 0 },
    });
    const l = await getPlanLimits("t1");
    expect(l.maxConcurrentAnalyses).toBeGreaterThanOrEqual(1);
    expect(l.analysesPerMinute).toBeGreaterThanOrEqual(1);
  });

  it("consulta o banco uma vez e reaproveita o cache", async () => {
    prismaFalso.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      plan: { maxConcurrentAnalyses: 4, analysesPerMinute: 20 },
    });
    await getPlanLimits("t1");
    await getPlanLimits("t1");
    expect(prismaFalso.subscription.findUnique).toHaveBeenCalledTimes(1);
  });

  it("invalidar força nova consulta: mudança de plano vale na hora", async () => {
    prismaFalso.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      plan: { maxConcurrentAnalyses: 4, analysesPerMinute: 20 },
    });
    await getPlanLimits("t1");
    await invalidatePlanLimits("t1");
    await getPlanLimits("t1");
    expect(prismaFalso.subscription.findUnique).toHaveBeenCalledTimes(2);
  });

  it("sem tenant, devolve o padrão sem tocar no banco", async () => {
    expect(await getPlanLimits(null)).toEqual({
      maxConcurrentAnalyses: 1,
      analysesPerMinute: 2,
    });
    expect(prismaFalso.subscription.findUnique).not.toHaveBeenCalled();
  });
});
