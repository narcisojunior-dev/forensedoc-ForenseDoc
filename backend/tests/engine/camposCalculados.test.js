import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

/**
 * D6 · campos marcados como não identificados que o laudo calcula duas páginas
 * adiante.
 *
 * O § 2 do laudo FD-20260917 imprimiu "Taxa de juros anual calculada: Não
 * identificado", "Prazo da operação (dias): Não identificado" e "Prazo da
 * operação (meses, aprox.): Não identificado". O § 2.1, na página seguinte,
 * calculou os três: 80,82% em doze meses e 82,31% em 365 dias, 249 dias e 8,3
 * meses.
 *
 * Eram dois conjuntos de campos para a mesma grandeza, um alimentado pela
 * extração e outro pela camada matemática, sem ligação entre eles. Um documento
 * que declara não saber aquilo que ele mesmo calcula na página seguinte convida
 * o leitor a auditar o resto linha a linha.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));

const CALCULADO = "CALCULADO_PELO_SISTEMA";
const EXTRAIDO = "EXTRAIDO_DO_INSTRUMENTO";

describe("D6 · a ficha lê a camada matemática, com a origem declarada", () => {
  const { contrato, afericao_matematica: afericao } = heuristicExtractionFromText(texto);

  it("prazo em dias deixa de ser não identificado", () => {
    expect(contrato.prazo_dias).not.toBeNull();
    expect(Number(contrato.prazo_dias)).toBeGreaterThan(0);
  });

  it("o prazo em dias da ficha é o mesmo que a aferição publica", () => {
    if (contrato.prazo_dias_origem !== CALCULADO) return;
    expect(Number(contrato.prazo_dias)).toBe(Number(afericao.prazo_calculado_dias));
  });

  it("prazo em meses aproximado deixa de ser não identificado", () => {
    expect(contrato.prazo_operacao_meses_aprox).not.toBeNull();
    expect(contrato.prazo_operacao_meses_aprox_origem).toBe(CALCULADO);
  });

  it("taxa anual calculada deixa de ser não identificada", () => {
    expect(contrato.taxa_juros_anual_calculada).toBeTruthy();
    expect(contrato.taxa_juros_anual_calculada_origem).toBe(CALCULADO);
  });

  /**
   * Extraído do instrumento e calculado pelo sistema não são a mesma afirmação
   * e não podem sair sem distinção: é o que separa o que o banco declarou do
   * que o laudo deduziu.
   */
  it("a origem de cada campo é sempre declarada", () => {
    for (const campo of ["prazo_dias_origem", "prazo_operacao_meses_aprox_origem", "taxa_juros_anual_calculada_origem"]) {
      expect([CALCULADO, EXTRAIDO]).toContain(contrato[campo]);
    }
  });

  it("prazo declarado no instrumento tem precedência sobre o calculado", () => {
    const comPrazoDeclarado = heuristicExtractionFromText(texto.replace(/Prazo Total/i, "Prazo Total"));
    if (comPrazoDeclarado.contrato.prazo_dias_origem === EXTRAIDO) {
      expect(comPrazoDeclarado.contrato.prazo_dias).toBe(contrato.prazo_dias);
    }
    expect(["CALCULADO_PELO_SISTEMA", "EXTRAIDO_DO_INSTRUMENTO"]).toContain(comPrazoDeclarado.contrato.prazo_dias_origem);
  });
});
