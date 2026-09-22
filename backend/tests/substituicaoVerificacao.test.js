import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ linhas: [] }));
vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    laudoVerification: {
      findFirst: vi.fn(async ({ where }) =>
        db.linhas.find((l) => l.analysisId === where.analysisId && l.status === where.status) || null
      ),
      create: vi.fn(async ({ data }) => {
        const l = { id: `v${db.linhas.length + 1}`, ...data };
        db.linhas.push(l);
        return l;
      }),
      update: vi.fn(async ({ where, data }) => {
        const l = db.linhas.find((x) => x.id === where.id);
        Object.assign(l, data);
        return l;
      }),
      findUnique: vi.fn(async ({ where }) => db.linhas.find((l) => l.id === where.id) || null),
    },
  },
}));

const { emitirVerificacao, substituirVerificacaoVigente } = await import("../src/services/verificacaoStore.js");

const result = { reportId: "FD-1", generatedAt: "2026-09-19T12:00:00.000Z", hashes: {}, text: "{}" };

beforeEach(() => {
  db.linhas = [];
});

describe("substituirVerificacaoVigente", () => {
  it("aposenta a vigente e emite outra quando o conteúdo mudou", async () => {
    const antiga = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const nova = await substituirVerificacaoVigente("a1", "t1", { ...result, reportId: "FD-2" });

    expect(nova.id).not.toBe(antiga.id);
    expect(db.linhas.find((l) => l.id === antiga.id).status).toBe("SUBSTITUIDO");
  });

  it("não emite nada quando o recálculo não alterou o conteúdo", async () => {
    // reviewAnalysisFields e correctAnalysisGeo recalculam sempre, mesmo quando
    // o usuário confirma o valor que já estava lá. Emitir um laudo novo nesse
    // caso invalidaria um documento que continua correto.
    const antiga = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const nova = await substituirVerificacaoVigente("a1", "t1", result);

    expect(nova.id).toBe(antiga.id);
    expect(db.linhas).toHaveLength(1);
  });

  it("emite a primeira verificação para análise antiga que ainda não tem uma", async () => {
    const nova = await substituirVerificacaoVigente("a-antiga", "t1", result);
    expect(nova.status).toBe("VALIDO");
    expect(db.linhas).toHaveLength(1);
  });
});
