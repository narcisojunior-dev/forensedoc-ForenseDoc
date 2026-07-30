import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A separação de filas existe para impedir INVERSÃO DE PRIORIDADE.
 *
 * Com fila única e concorrência 1 (o default do BullMQ, que estava em uso), uma
 * análise com OCR de até 112 segundos bloqueava a confirmação de pagamento que
 * chegasse atrás dela: o cliente pagava, a Asaas entregava o webhook, e o
 * crédito só entrava quando o OCR de outro cliente terminasse.
 *
 * Estes testes prendem a propriedade que garante isso: cada tipo de trabalho vai
 * para a SUA fila. Um `add` no destino errado devolve a inversão sem aviso.
 */
// `add` precisa devolver promessa: os produtores encadeiam `.catch()` para não
// derrubar o fluxo do usuário quando o Redis está fora do ar.
const enfileirador = () => ({ add: vi.fn().mockResolvedValue({ id: "job-1" }) });

const filas = {
  analysisQueue: enfileirador(),
  paymentsQueue: enfileirador(),
  emailsQueue: enfileirador(),
  cronsQueue: enfileirador(),
};

vi.mock("../src/queues.js", () => filas);
vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    tenant: { findFirst: vi.fn().mockResolvedValue(null) },
    subscription: { update: vi.fn().mockResolvedValue({}) },
    notification: { create: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue({ email: "a@b.c", active: true }) },
  },
}));

const { enqueueEmail } = await import("../src/services/notificationService.js");

beforeEach(() => {
  for (const f of Object.values(filas)) {
    f.add.mockClear();
    f.add.mockResolvedValue({ id: "job-1" });
  }
});

describe("topologia de filas", () => {
  it("e-mail vai para a fila de e-mails, não para a de análise", async () => {
    await enqueueEmail({ to: "cliente@exemplo.com", template: "welcome", data: {} });

    expect(filas.emailsQueue.add).toHaveBeenCalledTimes(1);
    expect(filas.emailsQueue.add.mock.calls[0][0]).toBe("send-email");
    expect(filas.analysisQueue.add).not.toHaveBeenCalled();
    expect(filas.paymentsQueue.add).not.toHaveBeenCalled();
  });

  it("e-mail conserva o retry: SMTP falha de forma transitória", async () => {
    await enqueueEmail({ to: "cliente@exemplo.com", template: "welcome" });
    const opts = filas.emailsQueue.add.mock.calls[0][2];
    expect(opts.attempts).toBeGreaterThan(1);
    expect(opts.backoff?.type).toBe("exponential");
  });

  it("não enfileira e-mail sem destinatário", async () => {
    await enqueueEmail({ to: null, template: "welcome" });
    expect(filas.emailsQueue.add).not.toHaveBeenCalled();
  });
});

describe("nomes das filas", () => {
  it("são distintos entre si", async () => {
    // Duas chaves apontando para o mesmo nome recriariam a fila única sem que
    // nenhum outro teste percebesse.
    const { QUEUE_NAMES } = await vi.importActual("../src/queues.js");
    const nomes = Object.values(QUEUE_NAMES);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it("não reutilizam o nome da fila única antiga", async () => {
    // `saas-jobs` pode ter jobs órfãos no Redis de produção. Reaproveitar o nome
    // faria o worker novo consumir, com a topologia nova, jobs enfileirados pela
    // topologia antiga.
    const { QUEUE_NAMES } = await vi.importActual("../src/queues.js");
    expect(Object.values(QUEUE_NAMES)).not.toContain("saas-jobs");
  });
});
