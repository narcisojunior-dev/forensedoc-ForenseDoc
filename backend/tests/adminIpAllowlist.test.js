import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCidr, matchesCidrList, parseCidrList } from "../src/utils/ipAllowlist.js";

/**
 * N2 da auditoria — restrição de origem do painel da plataforma.
 *
 * O papel isPlatformAdmin concede crédito manual, suspende escritórios e edita
 * preços, e a única barreira era uma flag no JWT. Esta é a camada imediata
 * enquanto não há segundo fator.
 *
 * O ponto crítico coberto aqui é a semântica INVERTIDA em relação ao webhook:
 * lista vazia BLOQUEIA em produção (fail-closed). Errar para o lado restritivo
 * custa o operador reconfigurar o env; errar para o permissivo deixa o painel
 * financeiro aberto por esquecimento.
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

async function loadMiddleware({ ips, env }) {
  vi.resetModules();
  process.env.ADMIN_ALLOWED_IPS = ips ?? "";
  process.env.NODE_ENV = env;
  const mod = await import("../src/middleware/adminIpAllowlist.js");
  return mod.adminIpAllowlist;
}

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = ENV_ORIGINAL.NODE_ENV;
  process.env.ADMIN_ALLOWED_IPS = ENV_ORIGINAL.ADMIN_ALLOWED_IPS ?? "";
});

describe("adminIpAllowlist", () => {
  it("libera IP dentro da allowlist", async () => {
    const mw = await loadMiddleware({ ips: "203.0.113.10/32", env: "production" });
    const next = vi.fn();
    const res = mockRes();

    mw({ ip: "203.0.113.10" }, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("bloqueia IP fora da allowlist", async () => {
    const mw = await loadMiddleware({ ips: "203.0.113.10/32", env: "production" });
    const next = vi.fn();
    const res = mockRes();

    mw({ ip: "198.51.100.7" }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ADMIN_IP_NOT_ALLOWED");
  });

  it("BLOQUEIA em produção quando a allowlist está vazia (fail-closed)", async () => {
    const mw = await loadMiddleware({ ips: "", env: "production" });
    const next = vi.fn();
    const res = mockRes();

    mw({ ip: "203.0.113.10" }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ADMIN_IP_ALLOWLIST_UNSET");
  });

  it("libera em desenvolvimento com allowlist vazia, senão ninguém trabalha", async () => {
    const mw = await loadMiddleware({ ips: "", env: "development" });
    const next = vi.fn();

    mw({ ip: "127.0.0.1" }, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it("aceita IPv4 mapeado em IPv6, como o Express entrega atrás de proxy", async () => {
    const mw = await loadMiddleware({ ips: "203.0.113.10/32", env: "production" });
    const next = vi.fn();

    mw({ ip: "::ffff:203.0.113.10" }, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it("ignora entrada inválida sem derrubar as válidas", async () => {
    const mw = await loadMiddleware({ ips: "nao-e-ip,203.0.113.10/32", env: "production" });
    const next = vi.fn();

    mw({ ip: "203.0.113.10" }, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });
});

describe("utilitário de CIDR", () => {
  it("casa faixa /24 e recusa fora dela", () => {
    const lista = parseCidrList("198.51.100.0/24", "TESTE");
    expect(matchesCidrList("198.51.100.42", lista)).toBe(true);
    expect(matchesCidrList("198.51.101.42", lista)).toBe(false);
  });

  it("host único sem máscara vira /32", () => {
    const lista = parseCidrList("203.0.113.10", "TESTE");
    expect(matchesCidrList("203.0.113.10", lista)).toBe(true);
    expect(matchesCidrList("203.0.113.11", lista)).toBe(false);
  });

  it("recusa prefixo fora do intervalo válido", () => {
    expect(parseCidr("203.0.113.10/33")).toBeNull();
    expect(parseCidr("203.0.113.10/-1")).toBeNull();
  });

  it("lista vazia nunca casa — o chamador decide o fail-open/closed", () => {
    expect(matchesCidrList("203.0.113.10", [])).toBe(false);
  });
});
