import { describe, it, expect } from "vitest";
import { redact, redactUrl, requestContext } from "../src/utils/logRedaction.js";

/**
 * N7 da auditoria — não havia nenhuma camada de mascaramento, então qualquer
 * console.error carregando corpo de requisição ou headers despejava senha e
 * token em texto puro no stdout (que no Railway vai para agregador externo).
 */

describe("redact", () => {
  it("mascara senha e hash em objeto de requisição", () => {
    const r = redact({ email: "ana@x.com", password: "segredo", passwordHash: "$2a$12$..." });

    expect(r.email).toBe("ana@x.com"); // não é credencial
    expect(r.password).toBe("[REDACTED]");
    expect(r.passwordHash).toBe("[REDACTED]");
  });

  it("mascara headers de autenticação", () => {
    const r = redact({
      authorization: "Bearer eyJhbGciOi...",
      cookie: "refreshToken=abc123",
      "asaas-access-token": "whsec_xyz",
    });

    expect(Object.values(r)).toEqual(["[REDACTED]", "[REDACTED]", "[REDACTED]"]);
  });

  it("mascara em profundidade, não só no primeiro nível", () => {
    const r = redact({ req: { body: { newPassword: "segredo" } } });
    expect(r.req.body.newPassword).toBe("[REDACTED]");
  });

  it("mascara o PDF em base64, que inunda o log", () => {
    const r = redact({ pdfBase64: "JVBERi0xLjQK".repeat(1000) });
    expect(r.pdfBase64).toBe("[REDACTED]");
  });

  it("não estoura com referência circular", () => {
    const a = { nome: "x" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact(a).self).toBe("[circular]");
  });

  it("limita a profundidade", () => {
    let deep = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain("[deep]");
  });

  it("extrai o essencial de um Error sem o stack", () => {
    const err = new Error("falhou em https://api.x.com/cb?token=segredo");
    err.code = "P2002";
    const r = redact(err);

    expect(r.name).toBe("Error");
    expect(r.code).toBe("P2002");
    expect(r.message).not.toContain("segredo");
    expect(r.stack).toBeUndefined();
  });
});

describe("redactUrl", () => {
  it("mascara token em query string, preservando o resto", () => {
    const r = redactUrl("https://app.com/verify-email?token=abc123&lang=pt");
    expect(r).not.toContain("abc123");
    expect(r).toContain("lang=pt");
  });

  it("mascara os nomes usuais de credencial em query", () => {
    for (const p of ["token", "access_token", "refreshToken", "code", "key"]) {
      expect(redactUrl(`https://x.com/a?${p}=SEGREDO`)).not.toContain("SEGREDO");
    }
  });

  it("não mexe em URL sem credencial", () => {
    const url = "https://app.com/dashboard?page=2";
    expect(redactUrl(url)).toBe(url);
  });
});

describe("requestContext", () => {
  it("reúne o rastreável e omite corpo, cookie e Authorization", () => {
    const ctx = requestContext({
      method: "POST",
      originalUrl: "/api/auth/reset-password?token=segredo",
      ip: "203.0.113.7",
      tenantId: "t1",
      auth: { userId: "u1" },
      body: { newPassword: "segredo" },
      headers: { authorization: "Bearer x", cookie: "refreshToken=y" },
    });

    expect(ctx).toEqual({
      method: "POST",
      path: "/api/auth/reset-password",
      ip: "203.0.113.7",
      tenantId: "t1",
      userId: "u1",
    });
    expect(JSON.stringify(ctx)).not.toContain("segredo");
  });

  it("funciona em requisição não autenticada", () => {
    const ctx = requestContext({ method: "GET", path: "/api/billing/plans", ip: "1.2.3.4" });
    expect(ctx.userId).toBeNull();
    expect(ctx.tenantId).toBeNull();
  });
});
