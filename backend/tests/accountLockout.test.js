import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * N1 da auditoria — bloqueio por CONTA, não só por IP.
 *
 * O limite por IP protege a infraestrutura, não a credencial: com IPs rotativos
 * (botnet ou proxies residenciais), 500 origens davam 5.000 tentativas por
 * janela contra um único e-mail sem nunca disparar bloqueio.
 *
 * O contador do rate limit é mockado em memória para que o teste não dependa de
 * um Redis rodando; o que se verifica aqui é a CHAVE escolhida (identidade vs.
 * IP) e o `skipSuccessfulRequests`, que é o que impede o bloqueio de virar
 * negação de serviço contra o dono legítimo da conta.
 */

// Store em memória no lugar do Redis, preservando a semântica de contagem.
const contadores = new Map();

vi.mock("../src/utils/redis.js", () => ({
  redis: {
    call: vi.fn(async (cmd, ...args) => {
      if (cmd === "EVALSHA" || cmd === "EVAL" || cmd === "SCRIPT") return 0;
      return 0;
    }),
    get: vi.fn(),
    setex: vi.fn(),
  },
}));

// A store real do express-rate-limit, trocada por uma equivalente em memória.
vi.mock("rate-limit-redis", () => ({
  RedisStore: class {
    constructor({ prefix }) {
      this.prefix = prefix;
    }
    async increment(key) {
      const k = `${this.prefix}${key}`;
      const atual = (contadores.get(k) || 0) + 1;
      contadores.set(k, atual);
      return { totalHits: atual, resetTime: new Date(Date.now() + 60_000) };
    }
    async decrement(key) {
      const k = `${this.prefix}${key}`;
      contadores.set(k, Math.max(0, (contadores.get(k) || 0) - 1));
    }
    async resetKey(key) {
      contadores.delete(`${this.prefix}${key}`);
    }
  },
}));

const loginHandler = vi.fn();
vi.mock("../src/controllers/authController.js", () => ({
  register: (_req, res) => res.status(201).end(),
  login: (req, res) => loginHandler(req, res),
  refresh: (_req, res) => res.status(200).end(),
  verifyEmail: (_req, res) => res.status(200).end(),
  logout: (_req, res) => res.status(200).end(),
  me: (_req, res) => res.status(200).end(),
  forgotPassword: (_req, res) => res.status(200).end(),
  resetPassword: (_req, res) => res.status(200).end(),
  updateProfile: (_req, res) => res.status(200).end(),
  changePassword: (_req, res) => res.status(200).end(),
}));

vi.mock("../src/middleware/auth.js", () => ({
  requireAuth: (_req, _res, next) => next(),
}));

const authRoutes = (await import("../src/routes/authRoutes.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

const CREDENCIAL_INVALIDA = (_req, res) =>
  res.status(401).json({ error: "Credenciais inválidas." });

beforeEach(() => {
  contadores.clear();
  loginHandler.mockReset();
});

describe("bloqueio de conta no login", () => {
  it("bloqueia a conta após 5 falhas, mesmo variando o IP", async () => {
    loginHandler.mockImplementation(CREDENCIAL_INVALIDA);
    const app = makeApp();
    const alvo = { email: "vitima@exemplo.com", password: "errada" };

    const status = [];
    for (let i = 0; i < 7; i++) {
      // X-Forwarded-For diferente a cada tentativa simula IPs rotativos.
      const r = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${i + 1}`)
        .send(alvo);
      status.push(r.status);
    }

    expect(status.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(status.slice(5)).toEqual([429, 429]);
  });

  it("responde com código próprio para a tela distinguir do 401", async () => {
    loginHandler.mockImplementation(CREDENCIAL_INVALIDA);
    const app = makeApp();
    const alvo = { email: "vitima@exemplo.com", password: "errada" };

    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").send(alvo);
    const bloqueado = await request(app).post("/api/auth/login").send(alvo);

    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.code).toBe("ACCOUNT_TEMPORARILY_LOCKED");
  });

  it("a chave é a identidade: bloquear uma conta não afeta outra", async () => {
    loginHandler.mockImplementation(CREDENCIAL_INVALIDA);
    const app = makeApp();

    for (let i = 0; i < 6; i++) {
      await request(app).post("/api/auth/login").send({ email: "a@x.com", password: "errada" });
    }
    const outra = await request(app)
      .post("/api/auth/login")
      .send({ email: "b@x.com", password: "errada" });

    expect(outra.status).toBe(401); // não herdou o bloqueio de a@x.com
  });

  it("normaliza o e-mail: trocar a caixa não escapa do bloqueio", async () => {
    loginHandler.mockImplementation(CREDENCIAL_INVALIDA);
    const app = makeApp();

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").send({ email: "vitima@x.com", password: "e" });
    }
    const disfarce = await request(app)
      .post("/api/auth/login")
      .send({ email: "VITIMA@X.COM", password: "e" });

    expect(disfarce.status).toBe(429);
  });

  it("login bem-sucedido não consome a cota do dono legítimo", async () => {
    loginHandler.mockImplementation((_req, res) => res.status(200).json({ accessToken: "t" }));
    const app = makeApp();
    const cred = { email: "dono@x.com", password: "certa" };

    // Sem skipSuccessfulRequests, o uso normal trancaria o usuário fora.
    for (let i = 0; i < 8; i++) {
      const r = await request(app).post("/api/auth/login").send(cred);
      expect(r.status).toBe(200);
    }
  });

  it("requisição sem e-mail não compartilha balde com as demais", async () => {
    loginHandler.mockImplementation((_req, res) => res.status(400).end());
    const app = makeApp();

    for (let i = 0; i < 6; i++) await request(app).post("/api/auth/login").send({});
    // O balde `acct:` não pode existir; a conta real segue livre.
    loginHandler.mockImplementation(CREDENCIAL_INVALIDA);
    const real = await request(app)
      .post("/api/auth/login")
      .send({ email: "alguem@x.com", password: "e" });

    expect(real.status).toBe(401);
  });
});
