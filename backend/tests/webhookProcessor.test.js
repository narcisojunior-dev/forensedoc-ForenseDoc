import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regressão da falha C3 da auditoria.
 *
 * A Asaas envia PAYMENT_RECEIVED e PAYMENT_CONFIRMED para a mesma cobrança, e a
 * fila ainda reprocessa com `attempts: 5`. O guard antigo era um `findUnique`
 * seguido de `upsert` fora de transação: duas execuções liam o mesmo estado
 * "ainda não pago", ambas passavam e ambas creditavam — crédito duplicado sem
 * pagamento correspondente.
 *
 * O contrato fixado aqui: entregas repetidas do mesmo `payment.id` creditam
 * uma única vez.
 */

const payment = {
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
};
const tenant = { findFirst: vi.fn() };
const subscription = { findUnique: vi.fn(), update: vi.fn() };

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get payment() {
      return payment;
    },
    get tenant() {
      return tenant;
    },
    get subscription() {
      return subscription;
    },
  },
}));

vi.mock("../src/services/creditService.js", () => ({
  addAvulsoCredit: vi.fn(),
  addMonthlyCredits: vi.fn(),
  expireEmergencyCredits: vi.fn(),
  addEmergencyCredits: vi.fn(),
  wasEmergencyGrantedThisCycle: vi.fn(),
}));

vi.mock("../src/services/notificationService.js", () => ({ notify: vi.fn() }));
vi.mock("../src/queues.js", () => ({ saasQueue: { add: vi.fn() } }));

const creditService = await import("../src/services/creditService.js");
const { processWebhook } = await import("../src/jobs/webhookProcessor.js");

const TENANT = { id: "tenant-1" };
const AVULSO = {
  id: "pay_123",
  customer: "cus_1",
  value: 79,
  billingType: "PIX",
  subscription: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  tenant.findFirst.mockResolvedValue(TENANT);
});

/** Simula a linha do pagamento no banco, com a transição PENDING → PAID. */
function stubPaymentRow({ existsBefore = true } = {}) {
  let status = existsBefore ? "PENDING" : null;

  payment.updateMany.mockImplementation(async () => {
    if (status === "PENDING") {
      status = "PAID";
      return { count: 1 }; // esta execução reivindicou o pagamento
    }
    return { count: 0 }; // já pago, ou linha inexistente
  });

  payment.findUnique.mockImplementation(async () =>
    status ? { id: "row-1", tenantId: TENANT.id, type: "AVULSO", status } : null
  );

  payment.create.mockImplementation(async () => {
    if (status) {
      const err = new Error("Unique constraint failed");
      err.code = "P2002";
      throw err;
    }
    status = "PAID";
    return { id: "row-1", tenantId: TENANT.id, type: "AVULSO", status };
  });
}

describe("processWebhook — pagamento avulso", () => {
  it("credita uma vez quando a Asaas entrega o mesmo pagamento duas vezes", async () => {
    stubPaymentRow();

    await processWebhook({ data: { event: "PAYMENT_RECEIVED", payment: AVULSO } });
    await processWebhook({ data: { event: "PAYMENT_CONFIRMED", payment: AVULSO } });

    expect(creditService.addAvulsoCredit).toHaveBeenCalledTimes(1);
  });

  it("credita uma vez com entregas concorrentes do mesmo pagamento", async () => {
    stubPaymentRow();

    await Promise.all([
      processWebhook({ data: { event: "PAYMENT_RECEIVED", payment: AVULSO } }),
      processWebhook({ data: { event: "PAYMENT_CONFIRMED", payment: AVULSO } }),
    ]);

    expect(creditService.addAvulsoCredit).toHaveBeenCalledTimes(1);
  });

  it("credita ao criar a linha da cobrança gerada pela assinatura", async () => {
    // Cobrança criada pela Asaas não tem linha local prévia.
    stubPaymentRow({ existsBefore: false });

    await processWebhook({ data: { event: "PAYMENT_RECEIVED", payment: AVULSO } });

    expect(payment.create).toHaveBeenCalledTimes(1);
    expect(creditService.addAvulsoCredit).toHaveBeenCalledTimes(1);
  });

  it("não credita quando outra execução cria a linha em paralelo (P2002)", async () => {
    stubPaymentRow({ existsBefore: false });

    await Promise.all([
      processWebhook({ data: { event: "PAYMENT_RECEIVED", payment: AVULSO } }),
      processWebhook({ data: { event: "PAYMENT_CONFIRMED", payment: AVULSO } }),
    ]);

    expect(creditService.addAvulsoCredit).toHaveBeenCalledTimes(1);
  });

  it("não credita quando o tenant não é encontrado", async () => {
    stubPaymentRow();
    tenant.findFirst.mockResolvedValue(null);

    await processWebhook({ data: { event: "PAYMENT_RECEIVED", payment: AVULSO } });

    expect(creditService.addAvulsoCredit).not.toHaveBeenCalled();
    expect(payment.updateMany).not.toHaveBeenCalled();
  });
});
