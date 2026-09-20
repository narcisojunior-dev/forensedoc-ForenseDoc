import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ analises: [], verificacoes: [] }));
vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    analysis: { findMany: vi.fn(async () => db.analises) },
    laudoVerification: {
      findFirst: vi.fn(async ({ where }) => db.verificacoes.find((v) => v.analysisId === where.analysisId) || null),
      create: vi.fn(async ({ data }) => {
        const v = { id: `v${db.verificacoes.length + 1}`, ...data };
        db.verificacoes.push(v);
        return v;
      }),
    },
  },
}));

const { backfillVerificacoes } = await import("../scripts/backfill-verificacoes.js");

const analise = (id) => ({
  id,
  tenantId: "t1",
  result: { reportId: `FD-${id}`, generatedAt: "2026-09-19T12:00:00.000Z", hashes: { sha256: "AA" }, text: "{}" },
});

beforeEach(() => {
  db.analises = [];
  db.verificacoes = [];
});

describe("backfillVerificacoes", () => {
  it("cria verificação para laudo que ainda não tem", async () => {
    db.analises = [analise("a1"), analise("a2")];
    expect(await backfillVerificacoes({})).toEqual({ criadas: 2, puladas: 0, falhas: 0 });
  });

  it("é idempotente: rodar de novo não duplica", async () => {
    db.analises = [analise("a1")];
    await backfillVerificacoes({});
    expect(await backfillVerificacoes({})).toEqual({ criadas: 0, puladas: 1, falhas: 0 });
    expect(db.verificacoes).toHaveLength(1);
  });

  it("no modo seco não escreve nada", async () => {
    db.analises = [analise("a1")];
    const r = await backfillVerificacoes({ seco: true });
    expect(r.criadas).toBe(1);
    expect(db.verificacoes).toHaveLength(0);
  });

  it("uma falha não interrompe o lote", async () => {
    db.analises = [{ id: "quebrada", tenantId: "t1", result: null }, analise("a2")];
    const r = await backfillVerificacoes({});
    expect(r.criadas).toBe(1);
    expect(r.falhas).toBe(1);
  });
});
