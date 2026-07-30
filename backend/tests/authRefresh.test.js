import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regressão da falha H1 da auditoria.
 *
 * O refresh vale 30 dias e emite um access token novo a cada uso, mas só
 * conferia se o token existia, não fora revogado e não expirara. Conta
 * desativada, e-mail não confirmado e escritório suspenso eram checados apenas
 * no login — então uma sessão em curso seguia se renovando indefinidamente.
 */

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

const refreshToken = { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() };

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get refreshToken() {
      return refreshToken;
    },
  },
}));

vi.mock("../src/utils/redis.js", () => ({ redis: { get: vi.fn(), setex: vi.fn() } }));
vi.mock("../src/services/notificationService.js", () => ({ enqueueEmail: vi.fn() }));

const { refresh, REFRESH_COOKIE } = await import("../src/controllers/authController.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
      return this;
    },
  };
}

const req = () => ({ cookies: { [REFRESH_COOKIE]: "token-valido" }, body: {}, headers: {} });

/** Token válido e não expirado, variando só o estado do usuário/escritório. */
function storedToken(userOverrides = {}, tenantOverrides = {}) {
  return {
    id: "rt-1",
    userId: "user-1",
    revoked: false,
    expiresAt: new Date(Date.now() + 86_400_000),
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      role: "OWNER",
      isPlatformAdmin: false,
      active: true,
      emailVerified: true,
      tenant: { status: "ACTIVE", ...tenantOverrides },
      ...userOverrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshToken.update.mockResolvedValue({});
  refreshToken.create.mockResolvedValue({});
});

describe("POST /auth/refresh — revalidação do estado", () => {
  it("renova normalmente para usuário ativo e verificado", async () => {
    refreshToken.findUnique.mockResolvedValue(storedToken());
    const res = mockRes();

    await refresh(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("recusa usuário desativado (membro removido da equipe)", async () => {
    refreshToken.findUnique.mockResolvedValue(storedToken({ active: false }));
    const res = mockRes();

    await refresh(req(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DEACTIVATED");
    expect(res.body.accessToken).toBeUndefined();
  });

  it("recusa usuário com e-mail não confirmado", async () => {
    refreshToken.findUnique.mockResolvedValue(storedToken({ emailVerified: false }));
    const res = mockRes();

    await refresh(req(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("recusa escritório suspenso", async () => {
    refreshToken.findUnique.mockResolvedValue(storedToken({}, { status: "SUSPENDED" }));
    const res = mockRes();

    await refresh(req(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("não rotaciona o token quando a revalidação falha", async () => {
    refreshToken.findUnique.mockResolvedValue(storedToken({ active: false }));

    await refresh(req(), mockRes());

    // Rotacionar aqui queimaria o refresh token de quem for reativado depois.
    expect(refreshToken.update).not.toHaveBeenCalled();
    expect(refreshToken.create).not.toHaveBeenCalled();
  });

  it("revoga todas as sessões ao detectar reuso de token já rotacionado", async () => {
    refreshToken.findUnique.mockResolvedValue({ ...storedToken(), revoked: true });
    const res = mockRes();

    await refresh(req(), res);

    expect(res.statusCode).toBe(401);
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { revoked: true },
    });
  });
});
