import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validatePassword, MIN_LENGTH } from "../src/utils/passwordPolicy.js";

/**
 * N8 da auditoria — o único requisito era min(8), então "senha123" passava.
 *
 * A checagem de vazamento (HIBP) é desligada na maioria destes testes para não
 * depender de rede; ela tem bloco próprio no fim, com o fetch mockado.
 */

const ORIGINAL = process.env.PASSWORD_BREACH_CHECK;

beforeEach(() => {
  process.env.PASSWORD_BREACH_CHECK = "false";
});

afterEach(() => {
  process.env.PASSWORD_BREACH_CHECK = ORIGINAL;
  vi.restoreAllMocks();
});

describe("validatePassword", () => {
  it("aceita uma senha longa e sem relação com os dados do usuário", async () => {
    const r = await validatePassword("melancia-cadeira-viola", {
      email: "ana@escritorio.com",
      name: "Ana Souza",
    });
    expect(r.ok).toBe(true);
  });

  it(`recusa abaixo de ${MIN_LENGTH} caracteres`, async () => {
    const r = await validatePassword("senha123");
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(MIN_LENGTH));
  });

  it("recusa senha comum mesmo tendo o comprimento exigido", async () => {
    const r = await validatePassword("senha123456");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/comum/i);
  });

  it("recusa pouca variação de caracteres", async () => {
    const r = await validatePassword("aaaaaaaaaaaa");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/varia/i);
  });

  it("recusa senha que contém o e-mail do usuário", async () => {
    const r = await validatePassword("joaosilva-forte-2026", { email: "joaosilva@x.com" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/e-mail/i);
  });

  it("recusa senha que contém o nome, ignorando acento e caixa", async () => {
    const r = await validatePassword("MARIAzinha-secreta", { name: "María Antônia" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nome/i);
  });

  it("não confunde fragmento curto do nome com uso do nome", async () => {
    // "Ana" tem 3 letras: curto demais para servir de critério sem gerar
    // falso positivo em qualquer senha que contenha essas letras.
    const r = await validatePassword("banana-tropical-42", { name: "Ana Souza" });
    expect(r.ok).toBe(true);
  });

  it("recusa acima do limite de 72 bytes do bcrypt", async () => {
    const r = await validatePassword("a1b2c3d4e5".repeat(8)); // 80 bytes
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/72/);
  });

  it("conta bytes, não caracteres, no limite do bcrypt", async () => {
    // 40 emojis de 4 bytes = 160 bytes, apesar de "só" 40 caracteres.
    const r = await validatePassword("🔒".repeat(40));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/72/);
  });
});

describe("checagem de vazamento (HIBP)", () => {
  beforeEach(() => {
    process.env.PASSWORD_BREACH_CHECK = "true";
  });

  it("recusa senha cujo sufixo aparece na resposta do HIBP", async () => {
    // SHA-1 de "melancia-cadeira-viola" — devolvemos o sufixo real para simular
    // uma senha presente em vazamento.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha1").update("melancia-cadeira-viola").digest("hex").toUpperCase();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `${hash.slice(5)}:42\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1`,
      }))
    );

    const r = await validatePassword("melancia-cadeira-viola");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/vazamento/i);
  });

  it("envia apenas os 5 primeiros caracteres do hash (k-anonimato)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);

    await validatePassword("melancia-cadeira-viola");

    const url = fetchMock.mock.calls[0][0];
    const prefixo = url.split("/range/")[1];
    expect(prefixo).toHaveLength(5);
    // A senha e o hash completo nunca podem sair daqui.
    expect(url).not.toContain("melancia");
  });

  it("aceita a senha quando o HIBP está fora do ar (fail-open)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await validatePassword("melancia-cadeira-viola");
    expect(r.ok).toBe(true);
  });

  it("respeita PASSWORD_BREACH_CHECK=false sem tocar na rede", async () => {
    process.env.PASSWORD_BREACH_CHECK = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await validatePassword("melancia-cadeira-viola");
    expect(r.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
