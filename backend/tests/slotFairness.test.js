import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `acquireSlot` traduz o retorno do script Lua em decisão de produto.
 *
 * A semântica das faixas importa porque as duas recusas exigem ações diferentes
 * de quem lê: "a equipe está usando tudo" é capacidade do plano (esperar ou
 * contratar mais), enquanto "sua parte está cheia" significa que há vaga
 * reservada aos colegas (aguardar as suas próprias terminarem).
 *
 * A lógica de divisão em si é verificada contra Redis real pelo roteiro de
 * carga; aqui o que se prende é o contrato do módulo.
 */
const redisFalso = { eval: vi.fn(), zrem: vi.fn(), zremrangebyscore: vi.fn(), zcard: vi.fn() };
vi.mock("../src/utils/redis.js", () => ({ redis: redisFalso }));

const { acquireSlot, releaseSlot, SLOT_LOTADO, SLOT_COTA_DO_USUARIO } = await import(
  "../src/utils/lock.js"
);

beforeEach(() => vi.clearAllMocks());

describe("acquireSlot", () => {
  it("devolve token com o dono embutido, para a liberação ser rastreável", async () => {
    redisFalso.eval.mockResolvedValue(1);
    const r = await acquireSlot("analysis:t1", 4, 60, "user-123");
    expect(r.motivo).toBeNull();
    expect(r.token).toMatch(/^user-123:/);
  });

  it("distingue tenant lotado de cota do usuário", async () => {
    redisFalso.eval.mockResolvedValue(0);
    expect((await acquireSlot("k", 4, 60, "u")).motivo).toBe(SLOT_LOTADO);

    redisFalso.eval.mockResolvedValue(-1);
    const cota = await acquireSlot("k", 4, 60, "u");
    expect(cota.motivo).toBe(SLOT_COTA_DO_USUARIO);
    expect(cota.token).toBeNull();
  });

  it("passa as duas chaves: vagas e pretendentes", async () => {
    // Contar os recusados é o que impede quem chegou primeiro de reter tudo:
    // sem a segunda chave, ele liberaria uma vaga e a retomaria na hora.
    redisFalso.eval.mockResolvedValue(1);
    await acquireSlot("analysis:t1", 4, 60, "u");

    const args = redisFalso.eval.mock.calls[0];
    expect(args[1]).toBe(2);
    expect(args[2]).toBe("slots:analysis:t1");
    expect(args[3]).toBe("slots:analysis:t1:pretendentes");
  });

  it("sanitiza ':' no identificador do usuário", async () => {
    // O membro do sorted set é "<usuario>:<token>"; um ':' no id quebraria a
    // extração do dono e corromperia a contagem da divisão.
    redisFalso.eval.mockResolvedValue(1);
    const r = await acquireSlot("k", 4, 60, "a:b:c");
    expect(r.token.startsWith("a_b_c:")).toBe(true);
  });

  it("nunca envia limite abaixo de 1", async () => {
    redisFalso.eval.mockResolvedValue(1);
    await acquireSlot("k", 0, 60, "u");
    expect(Number(redisFalso.eval.mock.calls[0][5])).toBeGreaterThanOrEqual(1);
  });
});

describe("releaseSlot", () => {
  it("remove o membro exato, não o usuário inteiro", async () => {
    // Remover por usuário devolveria TODAS as vagas dele, e não a que terminou.
    await releaseSlot("analysis:t1", "user-1:tok-9");
    expect(redisFalso.zrem).toHaveBeenCalledWith("slots:analysis:t1", "user-1:tok-9");
  });

  it("ignora token ausente", async () => {
    await releaseSlot("k", null);
    expect(redisFalso.zrem).not.toHaveBeenCalled();
  });
});
