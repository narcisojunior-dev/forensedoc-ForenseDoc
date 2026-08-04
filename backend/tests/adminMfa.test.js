import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Segundo fator obrigatório no painel administrativo.
 *
 * A allowlist de IP (N2) restringe a ORIGEM; este middleware restringe a
 * IDENTIDADE. O que precisa ficar preso por teste é a distinção entre os dois
 * estados de recusa e, principalmente, o fato de a claim `mfa` do token não ser
 * suficiente sozinha quando ela é falsa: é aí que mora a diferença entre exigir
 * o segundo fator e apenas anunciá-lo.
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

/**
 * O middleware consulta o banco para distinguir "não cadastrou" de "sessão sem
 * verificação", então o Prisma entra mockado. `vi.resetModules` é necessário
 * porque a exigência é lida do ambiente no carregamento do módulo.
 */
async function carregar({ totpEnabledAt = null, exigir = true, falhaNoBanco = false } = {}) {
  vi.resetModules();
  if (exigir) delete process.env.ADMIN_REQUIRE_TOTP;
  else process.env.ADMIN_REQUIRE_TOTP = "false";

  vi.doMock("../src/utils/prisma.js", () => ({
    prisma: {
      user: {
        findUnique: falhaNoBanco
          ? vi.fn().mockRejectedValue(new Error("conexão perdida"))
          : vi.fn().mockResolvedValue({ totpEnabledAt }),
      },
    },
  }));
  vi.doMock("../src/utils/redis.js", () => ({ redis: { get: vi.fn() } }));

  const mod = await import("../src/middleware/auth.js");
  return mod.requireMfaForAdmin;
}

let exigenciaOriginal;

beforeEach(() => {
  // Só a variável desta funcionalidade é salva e restaurada. Trocar o
  // `process.env` inteiro apagaria o que o `dotenv` carregou ao importar
  // `utils/jwt.js`, e o módulo seguinte morreria por JWT_SECRET ausente.
  exigenciaOriginal = process.env.ADMIN_REQUIRE_TOTP;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("../src/utils/prisma.js");
  if (exigenciaOriginal === undefined) delete process.env.ADMIN_REQUIRE_TOTP;
  else process.env.ADMIN_REQUIRE_TOTP = exigenciaOriginal;
});

describe("requireMfaForAdmin", () => {
  it("deixa passar a sessão verificada com TOTP", async () => {
    const middleware = await carregar({ totpEnabledAt: new Date() });
    const next = vi.fn();
    const res = mockRes();

    await middleware({ auth: { userId: "u1", mfa: true } }, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("bloqueia quem ainda não cadastrou, apontando o caminho", async () => {
    const middleware = await carregar({ totpEnabledAt: null });
    const next = vi.fn();
    const res = mockRes();

    await middleware({ auth: { userId: "u1", mfa: false } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ADMIN_TOTP_NOT_ENROLLED");
  });

  it("bloqueia a sessão aberta antes do cadastro, pedindo novo login", async () => {
    const middleware = await carregar({ totpEnabledAt: new Date() });
    const next = vi.fn();
    const res = mockRes();

    await middleware({ auth: { userId: "u1", mfa: false } }, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ADMIN_TOTP_REQUIRED");
  });

  it("não aceita a claim ausente como verificada", async () => {
    const middleware = await carregar({ totpEnabledAt: new Date() });
    const next = vi.fn();
    const res = mockRes();

    // Token emitido antes desta funcionalidade existir: sem o campo `mfa`.
    await middleware({ auth: { userId: "u1" } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("não aceita valor apenas truthy no lugar do booleano", async () => {
    const middleware = await carregar({ totpEnabledAt: new Date() });
    const next = vi.fn();
    const res = mockRes();

    await middleware({ auth: { userId: "u1", mfa: "sim" } }, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("falha de banco fecha o painel, não abre", async () => {
    const middleware = await carregar({ falhaNoBanco: true });
    const next = vi.fn();
    const res = mockRes();

    await middleware({ auth: { userId: "u1", mfa: false } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("ADMIN_TOTP_CHECK_FAILED");
  });

  it("ADMIN_REQUIRE_TOTP=false devolve o comportamento anterior", async () => {
    const middleware = await carregar({ totpEnabledAt: null, exigir: false });
    const next = vi.fn();
    const res = mockRes();

    await middleware({ auth: { userId: "u1", mfa: false } }, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
