import { describe, it, expect } from "vitest";
import { validarFormaDaReferencia } from "../../src/utils/referenciaResidencial.js";

/**
 * D3 · validação da referência informada, na entrada.
 *
 * O dossiê C6 foi processado inteiro e só então o confronto foi recusado, porque
 * o operador digitou o endereço do escritório no campo da residência.
 *
 * A validação de FORMA roda antes de debitar crédito e de abrir o arquivo. A de
 * CONFLITO com o instrumento depende da UF extraída do PDF e roda depois, em
 * `avaliarConflitoReferencia`: não há como confrontar com o instrumento antes de
 * abrir o instrumento.
 */
describe("D3 · forma da referência informada", () => {
  it("endereço bem formado passa", () => {
    expect(validarFormaDaReferencia("Rua Alcides Araújo Mourão, 945, Santa Fé, Pedro II, PI, 64255-000").ok).toBe(true);
  });

  it("campo vazio passa: a referência é opcional", () => {
    expect(validarFormaDaReferencia("").ok).toBe(true);
    expect(validarFormaDaReferencia(null).ok).toBe(true);
  });

  it("sigla que não é UF é recusada com mensagem", () => {
    const r = validarFormaDaReferencia("Rua X, 10, Manaquiri, XY, 69435-000");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("UF_INVALIDA");
    expect(r.error).toMatch(/XY/);
    expect(r.error).toMatch(/Corrija/);
  });

  it("CEP malformado é recusado com mensagem", () => {
    const r = validarFormaDaReferencia("Rua X, 10, Manaquiri, AM, 694350");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CEP_INVALIDO");
    expect(r.error).toMatch(/oito d[íi]gitos/);
  });

  /** Endereço sem UF nem CEP é incompleto, não inválido: a geocodificação tenta. */
  it("endereço sem sigla e sem CEP não é recusado na entrada", () => {
    expect(validarFormaDaReferencia("Rua das Flores, 100, Centro").ok).toBe(true);
  });

  it("número de porta não é confundido com CEP", () => {
    expect(validarFormaDaReferencia("Rua X, 945, Pedro II, PI").ok).toBe(true);
  });
});
