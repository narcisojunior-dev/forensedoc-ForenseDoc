import { describe, it, expect } from "vitest";
import { classificarGrauProcessual, contarPorGrau, GRAUS_PROCESSO_CIVIL } from "../../src/engine/grausConclusao.js";

describe("Graus de Conclusão Forense Processual", () => {
  it("deve mapear corretamente achados para os 3 Graus Forenses", () => {
    // Constatados (vício material / prova direta no documento)
    expect(classificarGrauProcessual("ASS1")).toBe(GRAUS_PROCESSO_CIVIL.CONSTATADO);
    expect(classificarGrauProcessual("S5")).toBe(GRAUS_PROCESSO_CIVIL.CONSTATADO);
    expect(classificarGrauProcessual("CET2")).toBe(GRAUS_PROCESSO_CIVIL.CONSTATADO);
    expect(classificarGrauProcessual("TRL1")).toBe(GRAUS_PROCESSO_CIVIL.CONSTATADO);
    expect(classificarGrauProcessual("GEO1")).toBe(GRAUS_PROCESSO_CIVIL.CONSTATADO);
    expect(classificarGrauProcessual("IMG_REPEATED")).toBe(GRAUS_PROCESSO_CIVIL.CONSTATADO);

    // Não Verificáveis (ônus da prova do credor - art. 429, II do CPC c/c Tema 1.061/STJ)
    expect(classificarGrauProcessual("AUT1")).toBe(GRAUS_PROCESSO_CIVIL.NAO_VERIFICAVEL);
    expect(classificarGrauProcessual("BIO2")).toBe(GRAUS_PROCESSO_CIVIL.NAO_VERIFICAVEL);
    expect(classificarGrauProcessual("INT1")).toBe(GRAUS_PROCESSO_CIVIL.NAO_VERIFICAVEL);
    expect(classificarGrauProcessual("LIB1")).toBe(GRAUS_PROCESSO_CIVIL.NAO_VERIFICAVEL);
    expect(classificarGrauProcessual("LOG1")).toBe(GRAUS_PROCESSO_CIVIL.NAO_VERIFICAVEL);

    // Indícios (anomalias e circunstâncias fáticas dependentes de convergência)
    expect(classificarGrauProcessual("ADE1")).toBe(GRAUS_PROCESSO_CIVIL.INDICIO);
    expect(classificarGrauProcessual("ELA2")).toBe(GRAUS_PROCESSO_CIVIL.INDICIO);
    expect(classificarGrauProcessual("CAD1")).toBe(GRAUS_PROCESSO_CIVIL.INDICIO);
    expect(classificarGrauProcessual("EMP1")).toBe(GRAUS_PROCESSO_CIVIL.INDICIO);
    expect(classificarGrauProcessual("SEG2")).toBe(GRAUS_PROCESSO_CIVIL.INDICIO);
  });

  it("deve totalizar corretamente uma lista de achados com contarPorGrau", () => {
    const achados = [
      { codigo: "ASS1", gravidade: "ALTA" },
      { codigo: "AUT1", gravidade: "MÉDIA" },
      { codigo: "BIO2", gravidade: "ALTA" },
      { codigo: "ADE1", gravidade: "MÉDIA" },
      { codigo: "ELA2", gravidade: "MÉDIA" },
    ];

    const contagem = contarPorGrau(achados);
    expect(contagem.constatados).toBe(1);
    expect(contagem.naoVerificaveis).toBe(2);
    expect(contagem.indicios).toBe(2);
    expect(contagem.total).toBe(5);
  });
});
