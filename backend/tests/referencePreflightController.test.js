import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ order: [], tx: vi.fn(), debit: vi.fn(), release: vi.fn(), add: vi.fn(), extract: vi.fn(), heuristic: vi.fn() }));
vi.mock("../src/utils/prisma.js", () => ({ prisma: { $transaction: mocks.tx, analysis: { update: vi.fn() }, auditLog: { create: vi.fn(async () => ({})) } } }));
vi.mock("../src/services/creditService.js", () => ({ debitCredit: mocks.debit, refundCredit: vi.fn(), afterDebitCommit: vi.fn() }));
vi.mock("../src/queues.js", () => ({ analysisQueue: { add: mocks.add } }));
vi.mock("../src/utils/lock.js", () => ({ acquireSlot: vi.fn(async () => ({ token: "slot" })), releaseSlot: mocks.release, analysisLockKey: () => "key", SLOT_COTA_DO_USUARIO: "quota" }));
vi.mock("../src/services/planLimitsService.js", () => ({ getPlanLimits: vi.fn(async () => ({ maxConcurrentAnalyses: 1 })) }));
vi.mock("../src/services/ocrService.js", () => ({ ocrBudgetMs: () => 1000, extractPdfTextWithOcr: mocks.extract }));
vi.mock("../src/engine/extraction.js", () => ({ heuristicExtractionFromText: mocks.heuristic }));
vi.mock("../src/utils/redis.js", () => ({ redis: { get: vi.fn(async () => null), setex: vi.fn(async () => "OK") } }));
vi.mock("../src/services/reportPdfService.js", () => ({ buildReportPdf: vi.fn() }));
vi.mock("../src/services/geocodingService.js", () => ({ geocodeAddress: vi.fn(), reverseGeocode: vi.fn() }));
vi.mock("../src/services/apiService.js", () => ({ getIpInfo: vi.fn() }));
vi.mock("../src/services/objectStorageService.js", () => ({ putPdf: vi.fn(async () => null), buildKey: () => "pdf", deletePdf: vi.fn() }));
import { analyzePdf } from "../src/controllers/analyzeController.js";
const response = () => ({ status: vi.fn(function () { return this; }), json: vi.fn(function (body) { this.body = body; return this; }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.order.length = 0;
  mocks.extract.mockImplementation(async () => { mocks.order.push("leitura"); return { text: "contrato de teste", usedOcr: false }; });
  mocks.heuristic.mockReturnValue({ cliente: { cidade: "Manaquiri", estado: "AM", cep: "69435-000" } });
  mocks.tx.mockImplementation(async fn => { mocks.order.push("debito"); return fn({ analysis: { create: async () => ({ id: "id" }) } }); });
  mocks.debit.mockResolvedValue({ balanceBefore: 10 }); mocks.add.mockResolvedValue({});
});
const request = home => ({ auth: { userId: "u", tenantId: "t" }, body: { pdfBase64: Buffer.from("%PDF-1.7 test").toString("base64"), homeAddress: home }, headers: {} });
it("bloqueia UF divergente depois da leitura e antes do débito/fila", async () => {
  const res = response(); await analyzePdf(request("Rua X, Pedro II, PI, 64255-000"), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(res.body.code).toBe("CONFLITO_REFERENCIA");
  expect(mocks.order).toEqual(["leitura"]); expect(mocks.tx).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalled();
});
it("bloqueia CEP divergente antes do débito", async () => {
  const res = response(); await analyzePdf(request("Rua X, Manaquiri, AM, 69000-000"), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(res.body.conflito.motivo).toBe("CEP"); expect(mocks.tx).not.toHaveBeenCalled();
});
it("reutiliza no worker a leitura preliminar de referência compatível", async () => {
  const res = response(); await analyzePdf(request("Rua X, Manaquiri, AM, 69435-000"), res);
  expect(mocks.order).toEqual(["leitura", "debito"]); expect(res.status).toHaveBeenCalledWith(202);
  expect(mocks.add.mock.calls[0][1].preliminaryExtraction.text).toBe("contrato de teste");
});
