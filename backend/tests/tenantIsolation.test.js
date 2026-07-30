import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Isolamento entre escritórios.
 *
 * Os ids são UUID e não se adivinham, mas o isolamento não pode depender disso:
 * um id vazado por log, print ou URL compartilhada não pode dar acesso ao laudo
 * de outro cliente. Estes testes fixam o contrato de que a checagem de tenant
 * acontece em TODA leitura por id.
 */

const analysis = { findUnique: vi.fn(), update: vi.fn() };
const notification = { updateMany: vi.fn(), count: vi.fn() };

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get analysis() {
      return analysis;
    },
    get notification() {
      return notification;
    },
    auditLog: { create: vi.fn(() => Promise.resolve()) },
  },
}));

vi.mock("../src/services/creditService.js", () => ({
  debitCredit: vi.fn(),
  refundCredit: vi.fn(),
  afterDebitCommit: vi.fn(),
}));
vi.mock("../src/queues.js", () => ({
  analysisQueue: { add: vi.fn() },
  paymentsQueue: { add: vi.fn() },
  emailsQueue: { add: vi.fn() },
  cronsQueue: { add: vi.fn() },
}));
vi.mock("../src/utils/lock.js", () => ({
  acquireSlot: vi.fn(),
  releaseSlot: vi.fn(),
  analysisLockKey: (id) => `analysis:${id}`,
}));
vi.mock("../src/services/reportPdfService.js", () => ({ buildReportPdf: vi.fn() }));

const { getAnalysisStatus, getAnalysisResult, getAnalysisPdf, correctAnalysisGeo } = await import(
  "../src/controllers/analyzeController.js"
);
const { markAsRead } = await import("../src/controllers/notificationController.js");

function mockRes() {
  const res = {
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
    setHeader: vi.fn(),
  };
  return res;
}

const OUTRO_TENANT = {
  id: "analise-de-outro",
  tenantId: "tenant-B",
  status: "COMPLETED",
  result: { home: null },
};

const req = (overrides = {}) => ({
  params: { id: "analise-de-outro" },
  tenantId: "tenant-A",
  auth: { userId: "user-A", tenantId: "tenant-A" },
  headers: {},
  body: {},
  ip: "127.0.0.1",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  analysis.findUnique.mockResolvedValue(OUTRO_TENANT);
});

describe("análises de outro escritório", () => {
  it("getAnalysisStatus responde 404, sem revelar que o id existe", async () => {
    const res = mockRes();
    await getAnalysisStatus(req(), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Análise não encontrada." });
  });

  it("getAnalysisResult responde 404 e não devolve o laudo", async () => {
    const res = mockRes();
    await getAnalysisResult(req(), res);

    expect(res.statusCode).toBe(404);
    expect(res.body.result).toBeUndefined();
  });

  it("getAnalysisPdf responde 404 e não gera o PDF", async () => {
    const { buildReportPdf } = await import("../src/services/reportPdfService.js");
    const res = mockRes();
    await getAnalysisPdf(req(), res);

    expect(res.statusCode).toBe(404);
    expect(buildReportPdf).not.toHaveBeenCalled();
  });

  it("correctAnalysisGeo responde 404 e não escreve no registro alheio", async () => {
    const res = mockRes();
    await correctAnalysisGeo(req({ body: { lat: -5.09, lon: -42.81 } }), res);

    expect(res.statusCode).toBe(404);
    expect(analysis.update).not.toHaveBeenCalled();
  });

  it("permite acesso quando a análise é do próprio escritório", async () => {
    analysis.findUnique.mockResolvedValue({ ...OUTRO_TENANT, tenantId: "tenant-A" });
    const res = mockRes();
    await getAnalysisStatus(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });
});

describe("notificações de outro escritório", () => {
  it("markAsRead filtra por tenant no WHERE, não só pelo id", async () => {
    notification.updateMany.mockResolvedValue({ count: 0 });
    notification.count.mockResolvedValue(0);

    const res = mockRes();
    await markAsRead(req({ params: { id: "notif-de-outro" } }), res);

    // O tenant precisa fazer parte do UPDATE: sem isso, o id de outro
    // escritório casaria e marcaria a notificação alheia como lida.
    const where = notification.updateMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("tenant-A");
    expect(res.statusCode).toBe(404);
  });
});
