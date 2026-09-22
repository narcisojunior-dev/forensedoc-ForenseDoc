import { describe, it, expect } from "vitest";
import {
  canonicalizar,
  hashDoLaudo,
  gerarCodigo,
  normalizarChave,
  montarSnapshotPublico,
} from "../src/services/laudoVerificacao.js";

describe("canonicalizar", () => {
  it("ordena as chaves para que a ordem de serialização não mude o hash", () => {
    expect(canonicalizar({ b: 1, a: 2 })).toBe(canonicalizar({ a: 2, b: 1 }));
  });

  it("ordena em profundidade", () => {
    expect(canonicalizar({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it("preserva a ordem de arrays, que é conteúdo e não acidente", () => {
    expect(canonicalizar([2, 1])).toBe("[2,1]");
  });
});

describe("hashDoLaudo", () => {
  const result = { reportId: "FD-1", generatedAt: "2026-09-19T00:00:00.000Z", hashes: { sha256: "AA" } };

  it("é estável para o mesmo conteúdo", () => {
    expect(hashDoLaudo(result)).toBe(hashDoLaudo({ ...result }));
  });

  it("muda quando qualquer campo do laudo muda", () => {
    expect(hashDoLaudo(result)).not.toBe(hashDoLaudo({ ...result, reportId: "FD-2" }));
  });

  it("devolve 64 hexadecimais maiúsculos", () => {
    expect(hashDoLaudo(result)).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("gerarCodigo", () => {
  it("usa o formato impresso no laudo", () => {
    expect(gerarCodigo()).toMatch(/^FD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("não repete em mil gerações", () => {
    const vistos = new Set(Array.from({ length: 1000 }, () => gerarCodigo()));
    expect(vistos.size).toBe(1000);
  });
});

describe("normalizarChave", () => {
  it("aceita o código com ou sem hífen e em minúsculas", () => {
    expect(normalizarChave("fd7kq29xmr4tvb")).toEqual({ tipo: "codigo", valor: "FD-7KQ2-9XMR-4TVB" });
  });

  it("corrige as letras que se confundem ao digitar de um papel", () => {
    // I e L viram 1, O vira 0 (regra do base32 de Crockford).
    expect(normalizarChave("FD-IKQO-9XMR-4TVB").valor).toBe("FD-1KQ0-9XMR-4TVB");
  });

  it("aceita corpo que começa com FD sem confundir com o prefixo", () => {
    expect(normalizarChave("FD-FD12-3456-789A").valor).toBe("FD-FD12-3456-789A");
  });

  it("reconhece o hash de 64 hexadecimais", () => {
    const hash = "a".repeat(64);
    expect(normalizarChave(hash)).toEqual({ tipo: "hash", valor: "A".repeat(64) });
  });

  it("recusa o que não é nem um nem outro", () => {
    expect(normalizarChave("abc")).toEqual({ tipo: null, valor: null });
    expect(normalizarChave(null)).toEqual({ tipo: null, valor: null });
  });
});

describe("montarSnapshotPublico", () => {
  const result = {
    reportId: "FD-20260919-A1B2C3D4E5",
    generatedAt: "2026-09-19T12:00:00.000Z",
    hashes: { sha256: "ABC", sha1: "DEF" },
    file: { name: "contrato-ronney-menezes.pdf" },
    text: JSON.stringify({ cliente: { nome: "Ronney Menezes de Souza", cpf: "123.456.789-00" } }),
  };

  it("mascara o titular", () => {
    const s = montarSnapshotPublico(result);
    expect(s.titular).toEqual({ nome: "R***** M****** de S****", cpf: "***.456.789-**" });
  });

  it("leva os hashes do documento analisado, que não são dado pessoal", () => {
    expect(montarSnapshotPublico(result).documentoAnalisado).toEqual({ sha256: "ABC", sha1: "DEF" });
  });

  it("NÃO leva o nome do arquivo, que costuma carregar o nome do titular", () => {
    expect(JSON.stringify(montarSnapshotPublico(result))).not.toMatch(/contrato-ronney/i);
  });

  it("NÃO leva o veredito da perícia: autenticidade e conteúdo são perguntas diferentes", () => {
    const comSumario = { ...result, sumarioIrregularidades: { placar: { alta: 7 } } };
    expect(JSON.stringify(montarSnapshotPublico(comSumario))).not.toMatch(/placar|alta/);
  });

  it("aguenta laudo sem titular extraído", () => {
    const s = montarSnapshotPublico({ ...result, text: "{}" });
    expect(s.titular).toEqual({ nome: null, cpf: null });
  });
});
