import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * N9 da auditoria — segunda camada de CSRF, independente do SameSite.
 *
 * As rotas de auth autenticam por cookie (refresh/logout) e eram protegidas só
 * pelo SameSite=strict, que é uma decisão do navegador. Este guard confere a
 * origem no servidor.
 */

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

async function load({ origins = "https://app.forensedoc.com.br", env = "production" } = {}) {
  vi.resetModules();
  process.env.CORS_ORIGIN = origins;
  process.env.NODE_ENV = env;
  return (await import("../src/middleware/csrfGuard.js")).csrfGuard;
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.CORS_ORIGIN = ORIGINAL.CORS_ORIGIN;
  process.env.NODE_ENV = ORIGINAL.NODE_ENV;
});

describe("csrfGuard", () => {
  it("libera POST da origem permitida", async () => {
    const mw = await load();
    const next = vi.fn();

    mw({ method: "POST", headers: { origin: "https://app.forensedoc.com.br" } }, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it("bloqueia POST de origem estranha", async () => {
    const mw = await load();
    const next = vi.fn();
    const res = mockRes();

    mw({ method: "POST", headers: { origin: "https://site-malicioso.com" } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_REJECTED");
  });

  it("cai para o Referer quando não há Origin", async () => {
    const mw = await load();
    const permitido = vi.fn();
    const bloqueado = vi.fn();
    const res = mockRes();

    mw(
      { method: "POST", headers: { referer: "https://app.forensedoc.com.br/login" } },
      mockRes(),
      permitido
    );
    mw({ method: "POST", headers: { referer: "https://evil.com/x" } }, res, bloqueado);

    expect(permitido).toHaveBeenCalled();
    expect(bloqueado).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("não bloqueia métodos seguros", async () => {
    const mw = await load();
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const next = vi.fn();
      mw({ method, headers: { origin: "https://evil.com" } }, mockRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });

  it("libera requisição sem Origin nem Referer (curl, integração)", async () => {
    // Sem navegador não há cookie anexado automaticamente, então não há CSRF.
    // Bloquear aqui quebraria integração legítima sem fechar vetor nenhum.
    const mw = await load();
    const next = vi.fn();

    mw({ method: "POST", headers: {} }, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it("aceita localhost em dev, mas não em produção", async () => {
    const dev = await load({ env: "development" });
    const nextDev = vi.fn();
    dev({ method: "POST", headers: { origin: "http://localhost:5173" } }, mockRes(), nextDev);
    expect(nextDev).toHaveBeenCalled();

    const prod = await load({ env: "production" });
    const nextProd = vi.fn();
    prod({ method: "POST", headers: { origin: "http://localhost:5173" } }, mockRes(), nextProd);
    expect(nextProd).not.toHaveBeenCalled();
  });

  it("bloqueia Referer malformado em vez de deixar passar", async () => {
    const mw = await load();
    const next = vi.fn();
    const res = mockRes();

    mw({ method: "POST", headers: { referer: "nao-e-url" } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("suporta múltiplas origens configuradas", async () => {
    const mw = await load({ origins: "https://a.com,https://b.com" });
    for (const origin of ["https://a.com", "https://b.com"]) {
      const next = vi.fn();
      mw({ method: "POST", headers: { origin } }, mockRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });
});
