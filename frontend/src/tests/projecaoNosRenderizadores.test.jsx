import { describe, it, expect } from "vitest";
import { reportIssues } from "../laudo/laudoUtils.js";
import { marcarOrigem, fichaBeneficioSeAplica } from "../laudo/produto.js";

/**
 * Lacunas encontradas pelo Codex na revisão estática do lote 2. Cada teste
 * prende uma delas.
 */

describe("projeção canônica nos renderizadores", () => {
  const legado = {
    achados_irregularidade: [
      { codigo: "GPS-RES", gravidade: "ALTA", titulo: "Distância à residência", texto: "Achado excluído quando a referência é recusada." },
    ],
  };

  /**
   * `Array.isArray(p) && p.length` fazia `[]` cair no caminho legado e
   * ressuscitar achados que a projeção excluiu de propósito.
   */
  it("projeção vazia é resposta, não ausência de resposta", () => {
    expect(reportIssues(legado, []).map((i) => i.codigo)).toEqual([]);
  });

  it("sem projeção, o caminho legado continua valendo para laudos antigos", () => {
    expect(reportIssues(legado, null).map((i) => i.codigo)).toEqual(["GPS-RES"]);
    expect(reportIssues(legado, undefined).map((i) => i.codigo)).toEqual(["GPS-RES"]);
  });

  it("com projeção, ela é a fonte única e o legado é ignorado", () => {
    const projecao = [
      { key: "INT1", severity: "ALTA", title: "Ausência de resumo criptográfico", text: "Texto do achado." },
      { key: "TZ1", severity: "MÉDIA", title: "Bloco de assinatura sem fuso declarado", text: "Texto do achado." },
    ];
    const codigos = reportIssues(legado, projecao).map((i) => i.codigo);
    expect(codigos).toContain("INT1");
    expect(codigos).toContain("TZ1");
    expect(codigos).not.toContain("GPS-RES");
  });
});

describe("D6 · a origem é impressa junto do valor", () => {
  it("marca o que o sistema calculou", () => {
    expect(marcarOrigem("Prazo da operação (dias)", "CALCULADO_PELO_SISTEMA"))
      .toBe("Prazo da operação (dias) · calculado pelo sistema");
  });

  it("marca o que o instrumento declarou", () => {
    expect(marcarOrigem("Prazo da operação (dias)", "EXTRAIDO_DO_INSTRUMENTO"))
      .toBe("Prazo da operação (dias) · extraído do instrumento");
  });

  it("sem origem conhecida, o rótulo não afirma nada", () => {
    expect(marcarOrigem("Taxa de juros anual calculada", null)).toBe("Taxa de juros anual calculada");
    expect(marcarOrigem("Taxa de juros anual calculada", "OUTRA")).toBe("Taxa de juros anual calculada");
  });
});

describe("D7 · ficha por modalidade no laudo", () => {
  it("espelha a regra do backend", () => {
    expect(fichaBeneficioSeAplica("CONSIGNADO_CLT")).toBe(false);
    expect(fichaBeneficioSeAplica("CONSIGNADO_INSS")).toBe(true);
    expect(fichaBeneficioSeAplica(null)).toBe(true);
  });
});
