import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regressão da falha C1 da auditoria.
 *
 * O backend rotaciona o refresh token a cada uso e trata a reutilização de um
 * token já rotacionado como roubo, revogando TODAS as sessões do usuário. Com
 * duas requisições expirando ao mesmo tempo (o dashboard dispara transações e
 * estatísticas em paralelo), o interceptor mandava dois POST /auth/refresh com
 * o mesmo cookie — e o segundo derrubava o login legítimo.
 *
 * O contrato que estes testes fixam: N respostas 401 simultâneas produzem UMA
 * única chamada de refresh.
 */

// Precisa existir antes de o módulo axios.js ser importado.
vi.mock("axios", async () => {
  const post = vi.fn();
  const instance = vi.fn();
  instance.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  return {
    default: { create: vi.fn(() => instance), post },
    __instance: instance,
    __post: post,
  };
});

let axiosMod;
let axiosLib;
let onRejected;
let apiInstance;

beforeEach(async () => {
  vi.resetModules();

  axiosMod = await import("axios");
  axiosMod.__post.mockReset();
  axiosMod.__instance.mockReset();
  axiosMod.__instance.interceptors.response.use.mockReset();

  // Importar o módulo registra os interceptors; capturamos o handler de erro.
  axiosLib = await import("../lib/axios.js");
  apiInstance = axiosMod.default.create.mock.results.at(-1).value;
  onRejected = apiInstance.interceptors.response.use.mock.calls[0][1];

  // O retry da requisição original devolve um resultado qualquer.
  apiInstance.mockResolvedValue({ data: "ok" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function unauthorized(url) {
  return { response: { status: 401 }, config: { url, headers: {} } };
}

describe("interceptor de refresh do access token", () => {
  it("dispara um único /auth/refresh para várias 401 simultâneas", async () => {
    let resolveRefresh;
    axiosMod.__post.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );

    // Três requisições expiram juntas, como no carregamento do dashboard.
    const pending = [
      onRejected(unauthorized("/credits/transactions")),
      onRejected(unauthorized("/analyses/stats")),
      onRejected(unauthorized("/notifications/unread-count")),
    ];

    resolveRefresh({ data: { accessToken: "token-novo" } });
    await Promise.all(pending);

    expect(axiosMod.__post).toHaveBeenCalledTimes(1);
    expect(axiosMod.__post.mock.calls[0][0]).toContain("/auth/refresh");
  });

  it("aplica o token renovado a todas as requisições que aguardavam", async () => {
    axiosMod.__post.mockResolvedValue({ data: { accessToken: "token-novo" } });

    const primeira = unauthorized("/credits/transactions");
    const segunda = unauthorized("/analyses/stats");
    await Promise.all([onRejected(primeira), onRejected(segunda)]);

    expect(axiosLib.getAccessToken()).toBe("token-novo");
    expect(primeira.config.headers.Authorization).toBe("Bearer token-novo");
    expect(segunda.config.headers.Authorization).toBe("Bearer token-novo");
  });

  it("permite um novo refresh depois que o anterior termina", async () => {
    axiosMod.__post.mockResolvedValue({ data: { accessToken: "t1" } });
    await onRejected(unauthorized("/credits/transactions"));

    axiosMod.__post.mockResolvedValue({ data: { accessToken: "t2" } });
    await onRejected(unauthorized("/analyses/stats"));

    // A promise compartilhada precisa ser liberada ao fim: sem isso, uma
    // expiração posterior reusaria o token velho para sempre.
    expect(axiosMod.__post).toHaveBeenCalledTimes(2);
    expect(axiosLib.getAccessToken()).toBe("t2");
  });

  it("não tenta renovar quando a própria rota de refresh responde 401", async () => {
    await expect(onRejected(unauthorized("/auth/refresh"))).rejects.toBeDefined();
    expect(axiosMod.__post).not.toHaveBeenCalled();
  });
});
