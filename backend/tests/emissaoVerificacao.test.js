import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitirParaAnalise } from "../src/jobs/analysisWorker.js";

const store = vi.hoisted(() => ({ emitirVerificacao: vi.fn(async () => ({ codigo: "FD-AAAA-BBBB-CCCC" })) }));
vi.mock("../src/services/verificacaoStore.js", () => store);

beforeEach(() => store.emitirVerificacao.mockClear());

describe("emitirParaAnalise", () => {
  it("emite a verificação do laudo recém-concluído", async () => {
    await emitirParaAnalise({ analysisId: "a1", tenantId: "t1", result: { reportId: "FD-1" } });
    // A expectativa repete `substituindo` porque toHaveBeenCalledWith compara
    // o objeto inteiro: omitir a chave faz o teste falhar mesmo com o código
    // certo.
    expect(store.emitirVerificacao).toHaveBeenCalledWith({
      analysisId: "a1",
      tenantId: "t1",
      result: { reportId: "FD-1" },
      substituindo: null,
    });
  });

  it("não derruba a análise quando a emissão falha", async () => {
    // O laudo já está COMPLETED e o crédito já foi cobrado. Deixar a exceção
    // subir cairia no catch que estorna e marca REFUNDED, punindo o cliente
    // por uma falha que não tem nada a ver com a perícia.
    store.emitirVerificacao.mockRejectedValueOnce(new Error("unique violation"));
    await expect(emitirParaAnalise({ analysisId: "a1", tenantId: "t1", result: {} })).resolves.toBeNull();
  });
});
