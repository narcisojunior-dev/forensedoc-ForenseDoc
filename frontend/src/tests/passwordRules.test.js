import { describe, it, expect } from "vitest";
import { checkPassword, passwordRules, MIN_LENGTH, MAX_BYTES } from "../utils/passwordRules.js";

/**
 * Este módulo é o espelho no cliente de `backend/src/utils/passwordPolicy.js`.
 * Quando as duas pontas divergiram, o usuário preenchia o formulário inteiro,
 * via o campo marcado como válido e só descobria o problema no envio.
 *
 * Os testes fixam as regras que o cliente PODE verificar. Vazamento no HIBP e a
 * lista de senhas comuns moram no servidor e continuam sendo recusados por ele —
 * por isso os formulários também exibem o erro da API.
 */
describe("checkPassword", () => {
  const contexto = { email: "joaosilva@escritorio.com", name: "João Silva" };

  it("aceita senha longa e sem relação com os dados do usuário", () => {
    expect(checkPassword("melancia-cadeira-viola", contexto)).toEqual({ ok: true, error: null });
  });

  it(`recusa abaixo de ${MIN_LENGTH} caracteres`, () => {
    const r = checkPassword("senha123", contexto);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(MIN_LENGTH));
  });

  it("recusa senha com pouca variação de caracteres", () => {
    expect(checkPassword("aaaaaaaaaaaa", contexto).ok).toBe(false);
  });

  it("recusa senha que contém o nome, ignorando acento e caixa", () => {
    // "João" normalizado é "joao" — a senha usa "JOAO", que precisa casar.
    const r = checkPassword("JOAO-secreta-2026", contexto);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nome/i);
  });

  it("recusa senha que contém a parte local do e-mail", () => {
    const r = checkPassword("joaosilva-forte-99", contexto);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/e-mail/i);
  });

  it("não confunde fragmento curto do nome com uso do nome", () => {
    // "Ana" tem 3 letras: curto para servir de critério sem falso positivo.
    expect(checkPassword("banana-tropical-42", { name: "Ana Souza" }).ok).toBe(true);
  });

  it("conta BYTES no teto do bcrypt, não caracteres", () => {
    // 40 emojis de 4 bytes = 160 bytes, apesar de 40 caracteres.
    const r = checkPassword("🔒".repeat(40));
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(MAX_BYTES));
  });

  it("funciona sem contexto de nome/e-mail", () => {
    expect(checkPassword("melancia-cadeira-viola").ok).toBe(true);
  });
});

describe("passwordRules — espelho do que o backend exige", () => {
  it("mantém o mínimo em 10, igual ao passwordPolicy.js do backend", () => {
    // Se este teste falhar, alguém mudou um lado sem o outro.
    expect(MIN_LENGTH).toBe(10);
    expect(MAX_BYTES).toBe(72);
  });

  it("expõe as regras que bloqueiam o envio", () => {
    const obrigatorias = passwordRules.filter((r) => r.required).map((r) => r.id);
    expect(obrigatorias).toEqual(["length", "variety", "personal"]);
  });

  it("cada regra tem rótulo legível para o checklist da tela", () => {
    for (const regra of passwordRules) {
      expect(typeof regra.label).toBe("string");
      expect(regra.label.length).toBeGreaterThan(3);
    }
  });
});
