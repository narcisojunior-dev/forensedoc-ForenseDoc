import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSearchablePdf } from "./helpers/pdfDeTeste.js";

/**
 * Rotas novas do motor pericial v2: confronto com o processo e réplica
 * processual. O que se fixa aqui é o que não pode quebrar em silêncio:
 * isolamento entre escritórios, recusa antes de ocupar slot e a trava de
 * conferência humana da minuta.
 */

const analysis = { findUnique: vi.fn(), update: vi.fn() };
vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get analysis() {
      return analysis;
    },
    auditLog: { create: vi.fn(() => Promise.resolve()) },
  },
}));
const queue = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("../src/queues.js", () => ({ analysisQueue: queue }));
const lock = vi.hoisted(() => ({
  acquireSlot: vi.fn(async () => ({ token: "tok", motivo: null })),
  releaseSlot: vi.fn(),
}));
vi.mock("../src/utils/lock.js", () => ({
  ...lock,
  analysisLockKey: (id) => `analysis:${id}`,
  SLOT_COTA_DO_USUARIO: "COTA_DO_USUARIO",
}));
vi.mock("../src/services/planLimitsService.js", () => ({ getPlanLimits: vi.fn(async () => ({ maxConcurrentAnalyses: 1 })) }));
const storage = vi.hoisted(() => ({ putPdf: vi.fn(async (key) => key), deletePdf: vi.fn(), buildKey: (t, a) => `${t}/x/${a}.pdf` }));
vi.mock("../src/services/objectStorageService.js", () => storage);
vi.mock("../src/services/ocrService.js", () => ({ ocrBudgetMs: () => 60_000 }));

// Réplicas guardadas em memória, com a mesma chave por tenant do Redis.
const guardadas = vi.hoisted(() => new Map());
vi.mock("../src/services/replicaStore.js", () => ({
  REPLICA_TTL_SECONDS: 3600,
  salvarReplica: vi.fn(async (tenantId, r) => guardadas.set(`${tenantId}:${r.id}`, r)),
  lerReplica: vi.fn(async (tenantId, id) => guardadas.get(`${tenantId}:${id}`) || null),
  atualizarReplica: vi.fn(async (tenantId, id, fn) => {
    const atual = guardadas.get(`${tenantId}:${id}`);
    if (!atual) return null;
    const novo = { ...atual, ...fn(atual) };
    guardadas.set(`${tenantId}:${id}`, novo);
    return novo;
  }),
  listarReplicas: vi.fn(async () => []),
  apagarReplica: vi.fn(async (tenantId, id) => guardadas.delete(`${tenantId}:${id}`)),
}));
const motor = vi.hoisted(() => ({ buildReplicaDraft: vi.fn(), listReplicaScenarios: vi.fn() }));
vi.mock("../src/engine/replicas/index.js", () => motor);

const { startProcessComparison } = await import("../src/controllers/processComparisonController.js");
const { startReplica, getReplica, draftReplica } = await import("../src/controllers/replicaController.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const req = (tenantId, extra = {}) => ({
  auth: { userId: "u1", tenantId },
  tenantId,
  ip: "127.0.0.1",
  headers: {},
  params: {},
  body: {},
  ...extra,
});

const pdfB64 = makeSearchablePdf(["Processo"]).toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  guardadas.clear();
});

describe("confronto com o processo", () => {
  it("não expõe análise de outro escritório", async () => {
    analysis.findUnique.mockResolvedValue({ id: "a1", tenantId: "tenant-B", status: "COMPLETED", result: {} });
    const res = mockRes();
    await startProcessComparison(req("tenant-A", { params: { id: "a1" }, body: { pdfBase64: pdfB64 } }), res);
    expect(res.statusCode).toBe(404);
    expect(lock.acquireSlot).not.toHaveBeenCalled();
  });

  it("recusa PDF inválido antes de ocupar vaga", async () => {
    analysis.findUnique.mockResolvedValue({ id: "a1", tenantId: "tenant-A", status: "COMPLETED", result: {} });
    const res = mockRes();
    await startProcessComparison(req("tenant-A", { params: { id: "a1" }, body: { pdfBase64: "bm90IGEgcGRm" } }), res);
    expect(res.statusCode).toBe(400);
    expect(lock.acquireSlot).not.toHaveBeenCalled();
  });

  it("enfileira o confronto e marca o resultado como em andamento", async () => {
    analysis.findUnique.mockResolvedValue({ id: "a1", tenantId: "tenant-A", status: "COMPLETED", result: { text: "{}" } });
    const res = mockRes();
    await startProcessComparison(req("tenant-A", { params: { id: "a1" }, body: { pdfBase64: pdfB64, filename: "p.pdf" } }), res);
    expect(res.statusCode).toBe(202);
    expect(queue.add).toHaveBeenCalledWith("compare-process", expect.objectContaining({ analysisId: "a1", lockToken: "tok" }), expect.anything());
    expect(analysis.update.mock.calls[0][0].data.result.processComparison.status).toBe("PROCESSING");
  });
});

describe("réplica processual", () => {
  const documentos = [
    { name: "inicial.txt", base64: Buffer.from("Petição inicial").toString("base64") },
    { name: "contestacao.pdf", base64: pdfB64 },
  ];

  it("recusa lote inválido sem ocupar vaga nem gravar arquivo", async () => {
    const res = mockRes();
    await startReplica(req("tenant-A", { body: { documents: [{ name: "x.exe", base64: "TVo=" }] } }), res);
    expect(res.statusCode).toBe(400);
    expect(lock.acquireSlot).not.toHaveBeenCalled();
    expect(storage.putPdf).not.toHaveBeenCalled();
  });

  it("grava os autos, registra e enfileira a leitura", async () => {
    const res = mockRes();
    await startReplica(req("tenant-A", { body: { documents: documentos } }), res);
    expect(res.statusCode).toBe(202);
    expect(storage.putPdf).toHaveBeenCalledTimes(2);
    // A chave não carrega o nome original do arquivo.
    for (const [chave] of storage.putPdf.mock.calls) expect(chave).not.toMatch(/inicial|contestacao/);
    expect(queue.add).toHaveBeenCalledWith("replica-analyze", expect.objectContaining({ tenantId: "tenant-A" }), expect.anything());
  });

  it("não entrega a réplica a outro escritório", async () => {
    guardadas.set("tenant-B:r1", { id: "r1", tenantId: "tenant-B", status: "COMPLETED" });
    const res = mockRes();
    await getReplica(req("tenant-A", { params: { id: "r1" } }), res);
    expect(res.statusCode).toBe(404);
  });

  it("exige a declaração de conferência humana para montar a minuta", async () => {
    guardadas.set("tenant-A:r1", { id: "r1", status: "COMPLETED", result: { analysis: { dados: {} } } });
    const res = mockRes();
    await draftReplica(req("tenant-A", { params: { id: "r1" }, body: { letter: "N" } }), res);
    expect(res.statusCode).toBe(400);
    expect(motor.buildReplicaDraft).not.toHaveBeenCalled();
  });

  it("monta a minuta a partir da análise guardada, não da enviada pelo navegador", async () => {
    guardadas.set("tenant-A:r1", { id: "r1", status: "COMPLETED", result: { analysis: { dados: { re: "BANCO" }, preliminares: [{ cod: "III.3" }] } } });
    motor.buildReplicaDraft.mockResolvedValue({ status: "draft", readyForFiling: false, paragraphs: [], pendingPlaceholders: 0 });
    const res = mockRes();
    await draftReplica(
      req("tenant-A", {
        params: { id: "r1" },
        body: { letter: "n", reviewConfirmed: true, analysis: { forjada: true }, caseData: { re: "BANCO CORRIGIDO", "chave inválida!": "x" } },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    const payload = motor.buildReplicaDraft.mock.calls[0][0];
    expect(payload.analysis.forjada).toBeUndefined();
    expect(payload.letter).toBe("N");
    expect(payload.caseData).toEqual({ re: "BANCO CORRIGIDO" });
    expect(payload.preliminaries).toEqual(["III.3"]);
    expect(res.body.draft.readyForFiling).toBe(false);
  });

  it("recusa do motor por pré-requisito vira 422 com a mensagem dele", async () => {
    guardadas.set("tenant-A:r1", { id: "r1", status: "COMPLETED", result: { analysis: { dados: {} } } });
    motor.buildReplicaDraft.mockRejectedValue(new Error("foram lidos apenas 2 documento(s)"));
    const res = mockRes();
    await draftReplica(req("tenant-A", { params: { id: "r1" }, body: { letter: "A", reviewConfirmed: true } }), res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/2 documento/);
  });
});
