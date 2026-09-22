import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ buscarPorChave: vi.fn() }));
vi.mock("../src/services/verificacaoStore.js", () => store);
vi.mock("../src/utils/prisma.js", () => ({ prisma: { auditLog: { create: vi.fn(async () => ({})) } } }));

const { consultarLaudo } = await import("../src/controllers/verificacaoController.js");

const req = (chave) => ({ params: { chave }, ip: "203.0.113.9", get: () => "vitest" });
const res = () => {
  const r = { code: 200, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

const registro = {
  codigo: "FD-7KQ2-9XMR-4TVB",
  laudoHash: "A".repeat(64),
  reportId: "FD-20260919-A1B2C3D4E5",
  status: "VALIDO",
  emitidoEm: new Date("2026-09-19T12:00:00.000Z"),
  tenantId: "t-secreto",
  analysisId: "a-secreto",
  publicSnapshot: {
    titular: { nome: "R***** M******", cpf: "***.456.789-**" },
    documentoAnalisado: { sha256: "ABC", sha1: "DEF" },
    emissor: "ForenseDoc",
  },
  substituidoPor: null,
};

beforeEach(() => store.buscarPorChave.mockReset());

describe("consultarLaudo", () => {
  it("devolve a situação, os hashes e o titular mascarado", async () => {
    store.buscarPorChave.mockResolvedValue(registro);
    const r = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), r);

    expect(r.code).toBe(200);
    expect(r.body.situacao).toBe("VALIDO");
    expect(r.body.laudo.sha256).toBe("A".repeat(64));
    expect(r.body.titular.nome).toBe("R***** M******");
  });

  it("nunca devolve tenantId nem analysisId", async () => {
    store.buscarPorChave.mockResolvedValue(registro);
    const r = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), r);

    expect(JSON.stringify(r.body)).not.toMatch(/t-secreto|a-secreto|tenantId|analysisId/);
  });

  it("aceita o hash como chave", async () => {
    store.buscarPorChave.mockResolvedValue(registro);
    const r = res();
    await consultarLaudo(req("a".repeat(64)), r);

    expect(store.buscarPorChave).toHaveBeenCalledWith({ tipo: "hash", valor: "A".repeat(64) });
  });

  it("aponta o código novo quando o laudo foi substituído", async () => {
    store.buscarPorChave.mockResolvedValue({
      ...registro,
      status: "SUBSTITUIDO",
      substituidoPor: { codigo: "FD-ZZZZ-YYYY-XXXX" },
    });
    const r = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), r);

    expect(r.body.situacao).toBe("SUBSTITUIDO");
    expect(r.body.substituidoPor).toBe("FD-ZZZZ-YYYY-XXXX");
  });

  it("responde o MESMO corpo para chave inexistente e para chave malformada", async () => {
    // A diferença de mensagem confirmaria a existência de um laudo para quem
    // está tentando adivinhar códigos.
    store.buscarPorChave.mockResolvedValue(null);

    const inexistente = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), inexistente);
    const malformada = res();
    await consultarLaudo(req("nao-e-chave"), malformada);

    expect(inexistente.code).toBe(404);
    expect(malformada.code).toBe(404);
    expect(inexistente.body).toEqual(malformada.body);
  });

  it("não consulta o banco quando a chave é malformada", async () => {
    await consultarLaudo(req("nao-e-chave"), res());
    expect(store.buscarPorChave).not.toHaveBeenCalled();
  });
});
