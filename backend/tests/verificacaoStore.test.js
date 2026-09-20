import { describe, it, expect, beforeEach, vi } from "vitest";

const db = vi.hoisted(() => ({ linhas: [] }));

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    laudoVerification: {
      create: vi.fn(async ({ data }) => {
        const linha = { id: `v${db.linhas.length + 1}`, substituidoPorId: null, ...data };
        db.linhas.push(linha);
        return linha;
      }),
      findUnique: vi.fn(async ({ where }) => {
        const chave = Object.keys(where)[0];
        return db.linhas.find((l) => l[chave] === where[chave]) || null;
      }),
      update: vi.fn(async ({ where, data }) => {
        const linha = db.linhas.find((l) => l.id === where.id || l.codigo === where.codigo);
        Object.assign(linha, data);
        return linha;
      }),
    },
  },
}));

const { emitirVerificacao, buscarPorChave, cancelarVerificacao, anonimizarVerificacao } = await import(
  "../src/services/verificacaoStore.js"
);

const result = {
  reportId: "FD-20260919-A1B2C3D4E5",
  generatedAt: "2026-09-19T12:00:00.000Z",
  hashes: { sha256: "ABC", sha1: "DEF" },
  text: JSON.stringify({ cliente: { nome: "Ronney Menezes", cpf: "12345678900" } }),
};

beforeEach(() => {
  db.linhas = [];
});

describe("emitirVerificacao", () => {
  it("grava código, hash e snapshot mascarado", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect(v.codigo).toMatch(/^FD-/);
    expect(v.laudoHash).toMatch(/^[0-9A-F]{64}$/);
    expect(v.status).toBe("VALIDO");
    expect(v.publicSnapshot.titular.nome).toBe("R***** M******");
  });

  it("não grava nada em texto claro no snapshot", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect(JSON.stringify(v.publicSnapshot)).not.toMatch(/Ronney|12345678900/);
  });

  it("aposenta a verificação anterior quando o laudo é reemitido", async () => {
    const antiga = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const nova = await emitirVerificacao({
      analysisId: "a1",
      tenantId: "t1",
      result: { ...result, generatedAt: "2026-09-20T12:00:00.000Z" },
      substituindo: antiga.id,
    });
    const recarregada = db.linhas.find((l) => l.id === antiga.id);
    expect(recarregada.status).toBe("SUBSTITUIDO");
    expect(recarregada.substituidoPorId).toBe(nova.id);
  });
});

describe("buscarPorChave", () => {
  it("acha pelo código", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect((await buscarPorChave({ tipo: "codigo", valor: v.codigo })).id).toBe(v.id);
  });

  it("acha pelo hash", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect((await buscarPorChave({ tipo: "hash", valor: v.laudoHash })).id).toBe(v.id);
  });

  it("devolve null para chave sem tipo, sem consultar o banco", async () => {
    expect(await buscarPorChave({ tipo: null, valor: null })).toBeNull();
  });
});

describe("cancelarVerificacao", () => {
  it("registra a data e o motivo", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const c = await cancelarVerificacao(v.codigo, "emitido sobre arquivo errado");
    expect(c.status).toBe("CANCELADO");
    expect(c.canceladoMotivo).toBe("emitido sobre arquivo errado");
    expect(c.canceladoEm).toBeInstanceOf(Date);
  });
});

describe("anonimizarVerificacao", () => {
  it("esvazia o titular e mantém os hashes, que não são dado pessoal", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const a = await anonimizarVerificacao(v.id);
    expect(a.status).toBe("DADOS_REMOVIDOS");
    expect(a.publicSnapshot.titular).toEqual({ nome: null, cpf: null });
    expect(a.publicSnapshot.documentoAnalisado.sha256).toBe("ABC");
    expect(a.tenantId).toBeNull();
  });
});
