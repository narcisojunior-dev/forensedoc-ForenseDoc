import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ cancelarVerificacao: vi.fn() }));
vi.mock("../src/services/verificacaoStore.js", () => store);
vi.mock("../src/utils/prisma.js", () => ({ prisma: { auditLog: { create: vi.fn(async () => ({})) } } }));
// adminController importa estes dois no topo. Sem os mocks, o import do
// controller puxa o serviço de crédito e o de notificação inteiros para dentro
// do teste, junto das conexões que eles abrem.
vi.mock("../src/services/creditService.js", () => ({ addManualCredits: vi.fn(), invalidateCreditCache: vi.fn() }));
vi.mock("../src/services/notificationService.js", () => ({ notify: vi.fn() }));

const { cancelarLaudo } = await import("../src/controllers/adminController.js");

const res = () => {
  const r = { code: 200, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const req = (codigo, motivo) => ({
  params: { codigo },
  body: { motivo },
  auth: { userId: "u1" },
  ip: "203.0.113.9",
  get: () => "vitest",
});

describe("cancelarLaudo", () => {
  it("exige motivo: um laudo cancelado sem justificativa é pior que um laudo válido", async () => {
    store.cancelarVerificacao.mockImplementation(async () => ({}));
    const r = res();
    await cancelarLaudo(req("FD-7KQ2-9XMR-4TVB", "  "), r);
    expect(r.code).toBe(400);
    expect(store.cancelarVerificacao).not.toHaveBeenCalled();
  });

  it("cancela e devolve a situação nova", async () => {
    store.cancelarVerificacao.mockImplementation(async () => ({
      codigo: "FD-7KQ2-9XMR-4TVB",
      status: "CANCELADO",
    }));
    const r = res();
    await cancelarLaudo(req("FD-7KQ2-9XMR-4TVB", "emitido sobre arquivo errado"), r);

    expect(store.cancelarVerificacao.mock.calls.at(-1)).toEqual([
      "FD-7KQ2-9XMR-4TVB",
      "emitido sobre arquivo errado",
    ]);
    expect(r.body.situacao).toBe("CANCELADO");
  });

  it("devolve 404 quando o código não existe", async () => {
    // P2025 é o código do Prisma para "registro a atualizar não encontrado".
    store.cancelarVerificacao.mockImplementation(async () => {
      throw Object.assign(new Error("not found"), { code: "P2025" });
    });
    const r = res();
    await cancelarLaudo(req("FD-0000-0000-0000", "motivo"), r);
    expect(r.code).toBe(404);
  });
});
