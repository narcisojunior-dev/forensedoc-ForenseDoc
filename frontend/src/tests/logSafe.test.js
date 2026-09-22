import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { motivoDoErro } from "../lib/logSafe.js";

/**
 * Área I da auditoria de segurança — vazamento de dado sensível pelo console
 * do navegador.
 *
 * `console.error("...", error)` com um erro do axios imprimia o objeto inteiro,
 * e dentro dele ia `config.headers.Authorization` com o access token. O token
 * vive em memória justamente para não ficar legível (N3); o console desfazia
 * isso, porque sobrevive à navegação e aparece em print e gravação de tela.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(AQUI, "..");

/** Erro do axios como ele realmente chega: com config e headers dentro. */
function erroDoAxios() {
  const err = new Error("Request failed with status code 401");
  err.code = "ERR_BAD_REQUEST";
  err.config = {
    url: "/auth/me",
    headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.SEGREDO.assinatura" },
  };
  err.response = { status: 401, data: { error: "Token expirado." } };
  return err;
}

describe("motivoDoErro", () => {
  it("não deixa o access token escapar para o texto do log", () => {
    const texto = motivoDoErro(erroDoAxios());

    expect(texto).not.toMatch(/Bearer/i);
    expect(texto).not.toMatch(/SEGREDO/);
    expect(texto).not.toMatch(/Authorization/i);
  });

  it("preserva o que serve para diagnosticar", () => {
    expect(motivoDoErro(erroDoAxios())).toBe("HTTP 401: Token expirado.");
  });

  it("devolve texto, nunca o objeto — é o que impede o despejo no console", () => {
    expect(typeof motivoDoErro(erroDoAxios())).toBe("string");
  });

  it("lida com erro de rede, que não tem resposta", () => {
    const err = new Error("Network Error");
    err.code = "ERR_NETWORK";
    expect(motivoDoErro(err)).toBe("ERR_NETWORK");
  });

  it("não quebra com erro nulo", () => {
    expect(motivoDoErro(null)).toBe("erro desconhecido");
  });
});

/**
 * Guarda de regressão: impede que alguém volte a passar o objeto de erro cru ao
 * console. A checagem é sobre o CÓDIGO-FONTE de propósito — um teste de runtime
 * só cobriria os caminhos que ele próprio executa, e o risco aqui é um console
 * novo, escrito depois, num arquivo que nenhum teste toca.
 */
describe("nenhum console.* recebe o objeto de erro cru", () => {
  function arquivosFonte(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        // Os próprios testes podem construir erros de mentira para inspecionar.
        return entrada.name === "tests" ? [] : arquivosFonte(completo);
      }
      return /\.(js|jsx)$/.test(entrada.name) ? [completo] : [];
    });
  }

  it("varre frontend/src e não encontra console.*(..., erro)", () => {
    // Casa `console.qualquercoisa(..., err)` / `(..., error)` / `(..., e)` —
    // o identificador cru de erro como argumento, que é o que despeja o objeto.
    const padrao = /console\.\w+\([^)]*,\s*(err|error|erro|e)\s*\)/;

    const infratores = arquivosFonte(SRC)
      .map((arquivo) => ({
        arquivo: path.relative(SRC, arquivo),
        linhas: fs
          .readFileSync(arquivo, "utf8")
          .split("\n")
          .map((linha, i) => ({ linha: linha.trim(), n: i + 1 }))
          // Comentário não executa: `logSafe.js` documenta justamente o padrão
          // proibido, e sem isto a guarda acusaria a própria explicação dela.
          .filter(({ linha }) => !linha.startsWith("*") && !linha.startsWith("//"))
          .filter(({ linha }) => padrao.test(linha)),
      }))
      .filter(({ linhas }) => linhas.length > 0)
      .map(({ arquivo, linhas }) => `${arquivo}:${linhas.map((l) => l.n).join(",")}`);

    expect(
      infratores,
      `Passe o erro por motivoDoErro() de lib/logSafe.js antes de logar. ` +
        `Um erro do axios carrega o access token em config.headers.`
    ).toEqual([]);
  });
});
