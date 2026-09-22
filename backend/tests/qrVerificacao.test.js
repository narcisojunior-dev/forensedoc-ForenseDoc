import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { desenharQr, urlDeVerificacao } from "../src/reports/qrVerificacao.js";

describe("urlDeVerificacao", () => {
  const original = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = "https://forensedoc.com.br/";
  });
  afterEach(() => {
    process.env.FRONTEND_URL = original;
  });

  it("monta a URL sem barra dupla", () => {
    expect(urlDeVerificacao("FD-7KQ2-9XMR-4TVB")).toBe(
      "https://forensedoc.com.br/verificar/FD-7KQ2-9XMR-4TVB"
    );
  });

  it("cai no host local quando a variável não está definida", () => {
    delete process.env.FRONTEND_URL;
    expect(urlDeVerificacao("FD-A")).toBe("http://localhost:5173/verificar/FD-A");
  });
});

describe("desenharQr", () => {
  function docFalso() {
    const chamadas = { rect: 0, fill: 0, save: 0, restore: 0 };
    const doc = {
      save: () => (chamadas.save++, doc),
      restore: () => (chamadas.restore++, doc),
      rect: () => (chamadas.rect++, doc),
      fill: () => (chamadas.fill++, doc),
      chamadas,
    };
    return doc;
  }

  it("desenha um retângulo por módulo preenchido", () => {
    const doc = docFalso();
    desenharQr(doc, { conteudo: "https://forensedoc.com.br/verificar/FD-A", x: 10, y: 20, lado: 90 });
    // 1 retângulo do fundo branco + 1 por módulo escuro.
    expect(doc.chamadas.rect).toBeGreaterThan(100);
    expect(doc.chamadas.save).toBe(1);
    expect(doc.chamadas.restore).toBe(1);
  });

  it("devolve o lado efetivo, para quem chama posicionar a legenda abaixo", () => {
    const doc = docFalso();
    const { lado } = desenharQr(doc, { conteudo: "x", x: 0, y: 0, lado: 90 });
    expect(lado).toBeLessThanOrEqual(90);
    expect(lado).toBeGreaterThan(0);
  });
});
