import { describe, it, expect } from "vitest";
import { mascararNome, mascararCpf } from "../src/utils/mascarar.js";

describe("mascararNome", () => {
  it("mantém a inicial de cada palavra e preserva o comprimento", () => {
    expect(mascararNome("Ronney Menezes de Souza")).toBe("R***** M****** de S****");
  });

  it("preserva partículas de até duas letras, que não identificam ninguém", () => {
    expect(mascararNome("Ana da Silva")).toBe("A** da S****");
  });

  it("normaliza espaços repetidos sem alterar a contagem de palavras", () => {
    expect(mascararNome("  Joao   Pedro  ")).toBe("J*** P****");
  });

  it("devolve null para entrada vazia, para a página não imprimir string vazia", () => {
    expect(mascararNome("")).toBeNull();
    expect(mascararNome(null)).toBeNull();
  });
});

describe("mascararCpf", () => {
  it("usa a convenção de divulgação parcial: três primeiros e dois últimos ocultos", () => {
    expect(mascararCpf("123.456.789-00")).toBe("***.456.789-**");
  });

  it("aceita o número sem formatação", () => {
    expect(mascararCpf("12345678900")).toBe("***.456.789-**");
  });

  it("recusa o que não tem onze dígitos, em vez de mascarar lixo", () => {
    expect(mascararCpf("123")).toBeNull();
    expect(mascararCpf(null)).toBeNull();
  });
});
