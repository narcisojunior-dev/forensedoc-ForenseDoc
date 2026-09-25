import { describe, it, expect } from "vitest";
import {
  camposDaReferencia,
  compararReferenciaComInstrumento,
  ufDoTexto,
  validarFormaDaReferencia,
} from "../../src/utils/referenciaResidencial.js";

/**
 * O endereço de referência é texto livre, e cada operador escreve de um jeito.
 * Um falso positivo aqui tem custo alto: ou o envio é recusado (UF ou CEP
 * "inválido"), ou o laudo imprime uma divergência cadastral que não existe.
 * Na dúvida, o leitor não afirma nada e a geocodificação decide depois.
 */
describe("referência residencial · formatos em que a UF é lida", () => {
  it.each([
    ["Rua Alcides Araújo Mourão, 945, Santa Fé, Pedro II, PI, 64255-000", "PI"],
    ["Rua X, 10, Centro, Teresina - PI", "PI"],
    ["Rua X, 10, Centro, Teresina – PI", "PI"],
    ["Rua X, 10, Centro, Teresina — PI", "PI"],
    ["Rua X, 10, Centro, Teresina/PI", "PI"],
    ["Rua X, 10, Centro, Teresina/PI 64000-000", "PI"],
    ["Rua X 10 Centro Teresina PI", "PI"],
    ["rua x, 10, centro, teresina, pi", "PI"],
    ["Rua X, 10, Centro, Teresina, PI.", "PI"],
    ["Rua X, 10, Centro, Teresina (PI)", "PI"],
    ["Rua X, 10, Centro, Teresina - PI, Brasil", "PI"],
    ["Rua X, 10, Centro, Teresina - PI - 64000-000, Brasil", "PI"],
    ["Rua X, 10, Centro, Teresina, UF: PI, CEP: 64000-000", "PI"],
    ["Rua X, 10, Centro, Teresina, Estado: Piauí", "PI"],
    ["Rua X, 10, Centro, Campo Grande, Estado: Mato Grosso do Sul", "MS"],
    ["Rua X, 10, Centro, Macapá, AP", "AP"],
    ["CEP 64000-000, Rua X, 10, Teresina - PI", "PI"],
  ])("%s → %s", (endereco, uf) => {
    expect(ufDoTexto(endereco)).toBe(uf);
    expect(validarFormaDaReferencia(endereco).ok).toBe(true);
  });
});

describe("referência residencial · partes do endereço que não são UF", () => {
  it.each([
    // Abreviações de endereço em posição final.
    "Rua Projetada, SN",
    "Rua Projetada, sn",
    "Rua A, s/n",
    "Rua A, 10, Qd",
    "Rua A, 10, Lote 5, QD",
    "Rua A, 10, BL",
    "Rua A, 10 - Fundos, FD",
    "Rodovia Estadual, Zona Rural, KM",
    "Av. Frei Serafim, Av",
    // Siglas de universidade não são o rótulo "UF".
    "Rua X, 10, próximo à UFJF, Juiz de Fora",
    "Rua X, 10, Conjunto UFCG, Campina Grande",
    "Rua X, 10, Vila UFRB",
    // Palavras de logradouro.
    "Rua do Sol, 10",
    "Av Brasil, 10",
    "Avenida Brasil",
    "Rua das Flores, Pedro II",
    "Av. Estado de Israel, 200",
    "Rua Estado do Maranhão, 45",
    "Travessa Dom Pedro I, 12",
    // Complemento antes da sigla.
    "Rua X, 10, Bloco MA",
    "Rua X, 10, Casa PA",
    "Rua X 10 Bloco AL",
  ])("não lê UF em: %s", (endereco) => {
    expect(ufDoTexto(endereco)).toBeNull();
    expect(validarFormaDaReferencia(endereco).ok).toBe(true);
  });

  it("nome de estado no fim, sem rótulo, não vira UF: há municípios com nome de outro estado", () => {
    // Tocantins é município de MG; Espírito Santo, do RN.
    expect(ufDoTexto("Rua X, 10, Centro, Tocantins")).toBeNull();
    expect(ufDoTexto("Rua X, 10, Centro, Espírito Santo")).toBeNull();
  });

  it("sigla de universidade não gera conflito de UF com o instrumento", () => {
    expect(compararReferenciaComInstrumento({ estado: "MG" }, "Rua X, 10, próximo à UFPI, Juiz de Fora, MG")).toBeNull();
    expect(compararReferenciaComInstrumento({ estado: "MG" }, "Rua X, 10, Campus UFPI, Juiz de Fora")).toBeNull();
  });

  it("sigla desconhecida em posição de estado continua recusada", () => {
    expect(validarFormaDaReferencia("Rua X, 10, Manaquiri, XY, 69435-000").code).toBe("UF_INVALIDA");
    expect(validarFormaDaReferencia("Rua X, 10, Teresina - PU").code).toBe("UF_INVALIDA");
    expect(validarFormaDaReferencia("Rua X, 10, Teresina, UF: PU").code).toBe("UF_INVALIDA");
  });
});

describe("referência residencial · CEP", () => {
  it.each([
    ["Rua X, 10, Teresina - PI, 64000-000", "64000000"],
    ["Rua X, 10, Teresina - PI, 64.000-000", "64000000"],
    ["Rua X, 10, Teresina - PI, CEP 64000000", "64000000"],
    ["Rua X, 10, Teresina - PI, CEP: 64000 000", "64000000"],
    ["Rua X, 10, Teresina - PI, C.E.P. 64000-000", "64000000"],
    ["Rua X, 10, Teresina - PI, cep nº 64000-000", "64000000"],
    ["Rua X, 10, 64000-000, Teresina - PI", "64000000"],
    ["64000-000 Rua X, 10, Teresina - PI", "64000000"],
    ["Rua X, 10, Teresina - PI 64000-000", "64000000"],
  ])("%s → %s", (endereco, cep) => {
    expect(camposDaReferencia(endereco).cep).toBe(cep);
    expect(validarFormaDaReferencia(endereco).ok).toBe(true);
  });

  it.each([
    "Rua X, 945, Pedro II, PI",
    "Rua X, 12345, Teresina - PI",
    "Rodovia BR-316, Km 12, Zona Rural, Teresina - PI",
    "Rua X, 10, Teresina - PI, sem CEP",
    "Rua X, 10, Teresina - PI, CEP: não possui",
    "Rua X, 10, Teresina - PI, fone 86999998888",
    "Quadra 104 Sul, Alameda 5, Lote 12, Palmas - TO",
  ])("não lê CEP em: %s", (endereco) => {
    expect(camposDaReferencia(endereco).cep).toBeNull();
    expect(validarFormaDaReferencia(endereco).ok).toBe(true);
  });

  it.each(["69000-00", "69000-0000", "690000", "690000000"])("CEP rotulado e malformado continua recusado: %s", (cep) => {
    expect(validarFormaDaReferencia(`Rua X, Manaus, AM, CEP ${cep}`).code).toBe("CEP_INVALIDO");
  });

  it("CEP genérico do município e CEP de logradouro do mesmo setor não são divergência", () => {
    expect(compararReferenciaComInstrumento({ estado: "PI", cep: "64255-000" }, "Rua X, 10, Pedro II - PI, 64255-123")).toBeNull();
    expect(compararReferenciaComInstrumento({ estado: "PI", cep: "64255-123" }, "Rua X, 10, Pedro II - PI, 64255-000")).toBeNull();
  });

  it("CEP de outro setor continua divergência", () => {
    expect(compararReferenciaComInstrumento({ estado: "AM", cep: "69435-000" }, "Rua X, Manaus, AM, 69000-000").motivo).toBe("CEP");
  });
});
