import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  base32Encode,
  base32Decode,
  gerarSegredo,
  gerarCodigo,
  verificarCodigo,
  passoAtual,
  montarOtpauthUrl,
  formatarParaDigitacao,
} from "../src/utils/totp.js";
import jwt from "jsonwebtoken";
import {
  generateAccessToken,
  generateTotpChallenge,
  verifyTotpChallenge,
  verifyAccessToken,
} from "../src/utils/jwt.js";

/**
 * Vetores de teste do RFC 6238, Apêndice B.
 *
 * O segredo do RFC é a string ASCII "12345678901234567890"; aqui ele entra em
 * base32 porque é essa a forma que o sistema guarda. Estes vetores são o que
 * separa "o código muda a cada 30 s" de "o código está CERTO": uma implementação
 * com o contador em 4 bytes, ou com o truncamento errado, passa por qualquer
 * teste caseiro e falha contra estes números, que é o que o aplicativo do
 * usuário vai calcular.
 */
const SEGREDO_RFC = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP: conformidade com o RFC 6238", () => {
  const vetores = [
    { segundos: 59, esperado: "287082" },
    { segundos: 1111111109, esperado: "081804" },
    { segundos: 1111111111, esperado: "050471" },
    { segundos: 1234567890, esperado: "005924" },
    { segundos: 2000000000, esperado: "279037" },
  ];

  it.each(vetores)("t=$segundos gera $esperado", ({ segundos, esperado }) => {
    const passo = Math.floor(segundos / 30);
    expect(gerarCodigo(SEGREDO_RFC, passo)).toBe(esperado);
  });

  it("mantém o contador correto além de 2^32 segundos", () => {
    // Um contador montado em 4 bytes funciona até 2038 e depois passa a gerar
    // código errado em silêncio. Aqui o passo já excede o que cabe em 32 bits.
    const passo = Math.floor(2 ** 32 / 30) + 1;
    expect(() => gerarCodigo(SEGREDO_RFC, passo)).not.toThrow();
    expect(gerarCodigo(SEGREDO_RFC, passo)).toMatch(/^\d{6}$/);
  });
});

describe("TOTP: base32", () => {
  it("faz ida e volta de valores aleatórios", () => {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.randomBytes(20);
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
  });

  it("aceita o segredo com espaços, como o usuário digita", () => {
    const segredo = gerarSegredo();
    expect(base32Decode(formatarParaDigitacao(segredo)).equals(base32Decode(segredo))).toBe(true);
  });

  it("recusa caractere fora do alfabeto", () => {
    expect(() => base32Decode("AAAA1AAA")).toThrow(/inválido/i);
  });

  it("gera segredo de 160 bits", () => {
    expect(base32Decode(gerarSegredo())).toHaveLength(20);
  });
});

describe("TOTP: verificação", () => {
  const agoraMs = 1_700_000_000_000;
  const segredo = gerarSegredo();

  it("aceita o código do passo atual e devolve o passo", () => {
    const codigo = gerarCodigo(segredo, passoAtual(agoraMs));
    expect(verificarCodigo(segredo, codigo, { agoraMs })).toBe(passoAtual(agoraMs));
  });

  it("tolera relógio adiantado ou atrasado em um passo", () => {
    for (const deriva of [-1, 1]) {
      const codigo = gerarCodigo(segredo, passoAtual(agoraMs) + deriva);
      expect(verificarCodigo(segredo, codigo, { agoraMs })).toBe(passoAtual(agoraMs) + deriva);
    }
  });

  it("recusa fora da janela", () => {
    for (const deriva of [-2, 2, 10]) {
      const codigo = gerarCodigo(segredo, passoAtual(agoraMs) + deriva);
      expect(verificarCodigo(segredo, codigo, { agoraMs })).toBeNull();
    }
  });

  it("recusa código de outro segredo", () => {
    const codigo = gerarCodigo(gerarSegredo(), passoAtual(agoraMs));
    expect(verificarCodigo(segredo, codigo, { agoraMs })).toBeNull();
  });

  it("recusa entrada malformada sem lançar", () => {
    for (const entrada of [null, undefined, "", "12345", "1234567", "abcdef", {}, []]) {
      expect(verificarCodigo(segredo, entrada, { agoraMs })).toBeNull();
    }
  });

  it("aceita o código como o usuário digita, com espaço ou hífen", () => {
    const codigo = gerarCodigo(segredo, passoAtual(agoraMs));
    const digitado = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
    expect(verificarCodigo(segredo, digitado, { agoraMs })).toBe(passoAtual(agoraMs));
  });
});

describe("TOTP: URL do autenticador", () => {
  it("traz o emissor no rótulo e no parâmetro", () => {
    const url = new URL(montarOtpauthUrl({ segredo: "ABCD", email: "a@b.com" }));
    expect(url.protocol).toBe("otpauth:");
    expect(decodeURIComponent(url.pathname)).toContain("ForenseDoc:a@b.com");
    expect(url.searchParams.get("issuer")).toBe("ForenseDoc");
    expect(url.searchParams.get("secret")).toBe("ABCD");
    expect(url.searchParams.get("period")).toBe("30");
  });
});

describe("Desafio de segundo fator", () => {
  /*
   * O teste que importa nesta suíte.
   *
   * O desafio é emitido quando a senha bateu e o TOTP ainda não. Se ele fosse
   * assinado com o segredo do access token, bastaria mandá-lo no header
   * Authorization para pular o segundo fator inteiro e falar com toda a API.
   */
  it("não é aceito como token de acesso", () => {
    const challenge = generateTotpChallenge({ userId: "u1", typ: "totp" });
    expect(() => verifyAccessToken(challenge)).toThrow();
  });

  it("token de acesso não é aceito como desafio", () => {
    const acesso = generateAccessToken({ userId: "u1", tenantId: "t1", role: "OWNER" });
    expect(() => verifyTotpChallenge(acesso)).toThrow();
  });

  it("expira, e um desafio vencido não abre sessão", () => {
    // `exp` no passado: é o que acontece com quem deixa a tela do código aberta
    // e volta meia hora depois.
    const vencido = jwt.sign({ userId: "u1" }, "qualquer", { expiresIn: "-1s" });
    expect(() => verifyTotpChallenge(vencido)).toThrow();
  });

  it("carrega o usuário e volta a ser legível", () => {
    const challenge = generateTotpChallenge({ userId: "u-42", typ: "totp" });
    expect(verifyTotpChallenge(challenge).userId).toBe("u-42");
  });
});
