import { describe, it, expect } from "vitest";
import { classificarProduto, campoFontePagadora, opcaoMarcadaDaFonte } from "../../src/engine/produto.js";

const MASTER_SERVIDORA = `CÉDULA DE CRÉDITO BANCÁRIO ("CCB") CONTRATAÇÃO DE SAQUE MEDIANTE TRANSFERÊNCIA
DE RECURSOS DO CARTÃO CONSIGNADO DE BENEFÍCIO CREDCESTA EMITIDO PELO BANCO MASTER S.A.
Tipo de Operação: X  Saque Fácil  Saque Complementar  Saque Refinanciamento
 FORÇAS ARMADAS  SERVIDOR PÚBLICO  INSS X  OUTROS
QUADRO 3 - DADOS FUNCIONAIS
Fonte Pagadora:
CREDCESTA GOV SP SECRETARIA
Matrícula/Nº Benefício:
7677078
na CCB não forem descontados em minha folha de pagamento/benefício, de forma parcial ou total,
pela minha Fonte Pagadora: X Sim Não;
representante legal, quando minha fonte pagadora for o Instituto Nacional do Seguro Social (INSS) nos
termos do §2o do art. 5o da Instrução Normativa INSS/PRES no 138, de 10 de novembro de 2022.`;

const MASTER_INSS = MASTER_SERVIDORA.replace("CREDCESTA GOV SP SECRETARIA", "MFACIL CONSIG INSS").replace("INSS X  OUTROS", "X INSS  OUTROS");

describe("fonte pagadora decide o produto antes da prosa das condições gerais", () => {
  it("lê o campo do quadro e não a cláusula", () => {
    expect(campoFontePagadora(MASTER_SERVIDORA)).toBe("CREDCESTA GOV SP SECRETARIA");
    expect(campoFontePagadora(MASTER_INSS)).toBe("MFACIL CONSIG INSS");
    expect(campoFontePagadora("pela minha Fonte Pagadora: X Sim Não;\nquando minha fonte pagadora for o INSS")).toBeNull();
  });
  it("o X marca a opção que vem depois dele", () => {
    expect(opcaoMarcadaDaFonte(MASTER_SERVIDORA)).toBe("OUTROS");
    expect(opcaoMarcadaDaFonte(MASTER_INSS)).toBe("INSS");
  });
  it("servidora do GOV SP não é consignado INSS", () => {
    const p = classificarProduto(MASTER_SERVIDORA);
    expect(p.codigo).toBe("CONSIGNADO_SERVIDOR");
    expect(p.confianca).toBe("ALTA");
  });
  it("a mesma CCB com fonte pagadora INSS continua INSS", () => {
    expect(classificarProduto(MASTER_INSS).codigo).toBe("CONSIGNADO_INSS");
  });
  it("sem campo preenchido, o título 'Consignado - INSS' ainda classifica", () => {
    expect(classificarProduto("Contrato de Empréstimo Pessoal - Consignado - INSS\nNB: 1234567890").codigo).toBe("CONSIGNADO_INSS");
  });
});
