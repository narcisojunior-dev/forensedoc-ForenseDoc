import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSearchablePdf } from "./helpers/pdfDeTeste.js";

/**
 * O administrador da plataforma (dono do sistema) gera laudos sem consumir
 * créditos. Os usuários clientes continuam dependendo de assinatura e avulsos.
 * Os dois lados precisam ser testados: a isenção não pode vazar para cliente.
 */

const prismaMock = vi.hoisted(() => ({
  analysis: { create: vi.fn(), update: vi.fn(() => Promise.resolve()) },
  auditLog: { create: vi.fn(() => Promise.resolve()) },
  $transaction: vi.fn(),
}));
vi.mock("../src/utils/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/utils/redis.js", () => ({
  redis: { get: vi.fn(async () => null), setex: vi.fn(async () => "OK") },
}));
const credito = vi.hoisted(() => ({
  hasCredit: vi.fn(async () => false),
  debitCredit: vi.fn(async () => ({ balanceBefore: { creditsMonthly: 1 } })),
  refundCredit: vi.fn(async () => {}),
  afterDebitCommit: vi.fn(async () => {}),
  getBalancePublic: vi.fn(async () => ({ total: 0, details: { monthly: 0, avulso: 0, emergency: 0, manual: 0 } })),
}));
vi.mock("../src/services/creditService.js", () => credito);
const fila = vi.hoisted(() => ({ add: vi.fn(async () => {}) }));
vi.mock("../src/queues.js", () => ({ analysisQueue: fila }));
vi.mock("../src/utils/lock.js", () => ({
  acquireSlot: vi.fn(async () => ({ token: "tok", motivo: null })),
  releaseSlot: vi.fn(),
  analysisLockKey: (id) => `analysis:${id}`,
  SLOT_COTA_DO_USUARIO: "COTA_DO_USUARIO",
}));
vi.mock("../src/services/planLimitsService.js", () => ({ getPlanLimits: vi.fn(async () => ({ maxConcurrentAnalyses: 1 })) }));
vi.mock("../src/services/objectStorageService.js", () => ({
  putPdf: vi.fn(async (k) => k),
  getPdf: vi.fn(async () => { throw new Error("falha simulada de leitura"); }),
  buildKey: (t, a) => `${t}/x/${a}.pdf`,
  deletePdf: vi.fn(),
}));
vi.mock("../src/services/reportPdfService.js", () => ({ buildReportPdf: vi.fn() }));
vi.mock("../src/services/notificationService.js", () => ({ notify: vi.fn(async () => {}) }));

const { requireCredit } = await import("../src/middleware/creditGuard.js");
const { analyzePdf } = await import("../src/controllers/analyzeController.js");
const { getBalance } = await import("../src/controllers/creditController.js");
const { processAnalysis } = await import("../src/jobs/analysisWorker.js");
const { notify } = await import("../src/services/notificationService.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const ADMIN = { userId: "ronney", tenantId: "t-admin", isPlatformAdmin: true };
const CLIENTE = { userId: "cliente", tenantId: "t-cliente", isPlatformAdmin: false };
const pdfBase64 = makeSearchablePdf(["Contrato"]).toString("base64");

const req = (auth, body = {}) => ({ auth, tenantId: auth.tenantId, body, ip: "127.0.0.1", headers: {} });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.analysis.create.mockResolvedValue({ id: "a1" });
  prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
});

describe("verificação de saldo", () => {
  it("deixa o administrador passar com saldo zero", async () => {
    const next = vi.fn();
    await requireCredit(req(ADMIN), mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(credito.hasCredit).not.toHaveBeenCalled();
  });

  it("recusa cliente sem saldo", async () => {
    const next = vi.fn();
    const res = mockRes();
    await requireCredit(req(CLIENTE), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
  });

  it("não aceita a marca de admin vinda de fora do token", async () => {
    const next = vi.fn();
    const r = { ...req(CLIENTE), body: { isPlatformAdmin: true } };
    await requireCredit(r, mockRes(), next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("débito na análise", () => {
  it("administrador: não debita nem dispara alerta de saldo", async () => {
    const res = mockRes();
    await analyzePdf(req(ADMIN, { pdfBase64, filename: "c.pdf" }), res);
    expect(res.statusCode).toBe(202);
    expect(credito.debitCredit).not.toHaveBeenCalled();
    expect(credito.afterDebitCommit).not.toHaveBeenCalled();
    expect(fila.add.mock.calls[0][1].creditoIsento).toBe(true);
  });

  it("cliente: continua debitando um crédito", async () => {
    const res = mockRes();
    await analyzePdf(req(CLIENTE, { pdfBase64, filename: "c.pdf" }), res);
    expect(res.statusCode).toBe(202);
    expect(credito.debitCredit).toHaveBeenCalledTimes(1);
    expect(fila.add.mock.calls[0][1].creditoIsento).toBe(false);
  });
});

describe("falha no processamento", () => {
  const job = (creditoIsento) => ({
    data: { analysisId: "a1", pdfKey: "k", tenantId: "t", userId: "u", lockToken: "tok", creditoIsento },
  });

  it("análise isenta falha sem tentar estorno", async () => {
    await processAnalysis(job(true));
    expect(credito.refundCredit).not.toHaveBeenCalled();
    expect(prismaMock.analysis.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "ERROR" } });
    expect(notify.mock.calls.at(-1)[0].body).not.toMatch(/estornado/);
  });

  it("análise de cliente continua sendo estornada", async () => {
    await processAnalysis(job(false));
    expect(credito.refundCredit).toHaveBeenCalledTimes(1);
  });
});

describe("saldo exibido", () => {
  it("marca o administrador como ilimitado e o cliente não", async () => {
    const resAdmin = mockRes();
    await getBalance(req(ADMIN), resAdmin);
    expect(resAdmin.body.balance.unlimited).toBe(true);

    const resCliente = mockRes();
    await getBalance(req(CLIENTE), resCliente);
    expect(resCliente.body.balance.unlimited).toBe(false);
  });
});
