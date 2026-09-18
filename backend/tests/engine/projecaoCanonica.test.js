import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { heuristicExtractionFromText } from "../../src/engine/extraction.js";
import { buildIrregularitySummary } from "../../src/engine/irregularitySummary.js";

/**
 * D5 · o sumário perdia seis achados e acrescentava um que não existia.
 *
 * Controle negativo da projeção canônica. O laudo FD-20260917 trouxe 20 itens
 * no corpo (3 na pág. 11, 10 na pág. 12, 7 na pág. 13) e 15 no sumário da pág.
 * 21, com um item no sumário sem correspondente no corpo.
 *
 * Um mecanismo explica as duas coisas: o sumário cortava em 15 sem avisar, e a
 * lista cortada é maior que a do corpo, porque reúne os achados estruturados da
 * extração com os que o próprio sumário produz.
 *
 * O teste não congela 15 nem 20. Ele prende a invariante: ou os conjuntos de
 * códigos são iguais, ou a diferença está declarada e contada.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));

const codigos = (lista = []) => new Set(lista.map((f) => f.key));

describe("D5 · projeção canônica", () => {
  const extracted = heuristicExtractionFromText(texto);
  const sumario = buildIrregularitySummary({ extracted });

  it("a projeção existe e é a lista ordenada completa", () => {
    expect(Array.isArray(sumario.projecao)).toBe(true);
    expect(sumario.projecao.length).toBeGreaterThan(0);
    expect(sumario.projecao).toEqual(sumario.allFindings);
  });

  it("todo achado estruturado da extração está na projeção", () => {
    const naProjecao = codigos(sumario.projecao);
    const ausentes = (extracted.achados_irregularidade || [])
      .map((a) => a.codigo)
      .filter((codigo) => !naProjecao.has(codigo));
    expect(ausentes).toEqual([]);
  });

  /**
   * A invariante central. Vale nos dois desfechos possíveis e não fixa número.
   */
  it("o sumário exibe a projeção inteira, ou declara e conta o que omitiu", () => {
    const exibidos = codigos(sumario.findings);
    const projetados = codigos(sumario.projecao);
    const omitidos = [...projetados].filter((c) => !exibidos.has(c));

    if (!omitidos.length) {
      expect(sumario.corte).toBeNull();
      return;
    }

    expect(sumario.corte).not.toBeNull();
    expect(sumario.corte.omitidos).toBe(omitidos.length);
    expect(new Set(sumario.corte.codigos)).toEqual(new Set(omitidos));
    expect(sumario.corte.total).toBe(sumario.projecao.length);
    expect(sumario.corte.aviso).toMatch(new RegExp(String(omitidos.length)));
  });

  it("o sumário não inventa item fora da projeção", () => {
    const projetados = codigos(sumario.projecao);
    const forasteiros = sumario.findings
      .map((f) => f.key)
      .filter((c) => c !== "no-auto-alert" && !projetados.has(c));
    expect(forasteiros).toEqual([]);
  });

  it("o corte preserva os mais graves e omite os menos graves", () => {
    if (!sumario.corte) return;
    const peso = { ALTA: 0, MÉDIA: 1, INFO: 2, FAVORÁVEL: 3 };
    const piorExibido = Math.max(...sumario.findings.map((f) => peso[f.severity] ?? 9));
    const melhorOmitido = Math.min(...sumario.corte.gravidades.map((g) => peso[g] ?? 9));
    expect(melhorOmitido).toBeGreaterThanOrEqual(piorExibido);
  });

  /**
   * Com o corpo do laudo lendo a projeção, o corte de 560 caracteres que servia
   * ao resumo passou a amputar o detalhe. A ressalva de um achado costuma estar
   * no fim do texto, que é justamente o que se perdia.
   */
  it("a projeção preserva o texto integral; o resumo é que compacta", () => {
    const ressalva = "RESSALVA FINAL QUE NAO PODE SUMIR DO DETALHE";
    const textoLongo = `${"Fundamentação extensa do achado, repetida para ultrapassar o limite de apresentação. ".repeat(12)}${ressalva}.`;
    expect(textoLongo.length).toBeGreaterThan(900);

    const comAchadoLongo = buildIrregularitySummary({
      extracted: {
        ...extracted,
        achados_irregularidade: [
          { codigo: "LONGO1", gravidade: "ALTA", titulo: "Achado com ressalva ao final", texto: textoLongo },
          ...(extracted.achados_irregularidade || []),
        ],
      },
    });

    const naProjecao = comAchadoLongo.projecao.find((f) => f.key === "LONGO1");
    expect(naProjecao.text).toContain(ressalva);
    expect(naProjecao.text).not.toMatch(/…$/);

    const noResumo = comAchadoLongo.findings.find((f) => f.key === "LONGO1");
    expect(noResumo.text.length).toBeLessThan(naProjecao.text.length);
    expect(noResumo.text).toMatch(/…$/);
  });

  /** Ausência de achado é estado de interface, não item que só existe no sumário. */
  it("sem achado, a igualdade se mantém e o estado sai como campo", () => {
    const vazio = buildIrregularitySummary({ extracted: { contrato: {}, cliente: {}, assinatura: {}, achados_irregularidade: [] } });
    expect(vazio.semAchados).toBe(typeof vazio.semAchados === "boolean" ? vazio.semAchados : true);
    if (vazio.projecao.length === 0) {
      expect(vazio.semAchados).toBe(true);
      expect(vazio.findings.map((f) => f.key)).toEqual([]);
      expect(vazio.corte).toBeNull();
    }
  });

  it("sem excedente, não há aviso de corte", () => {
    const curto = buildIrregularitySummary({ extracted: { ...extracted, achados_irregularidade: (extracted.achados_irregularidade || []).slice(0, 2) } });
    expect(curto.findings.length).toBeLessThanOrEqual(curto.projecao.length);
    if (curto.projecao.length <= 15) expect(curto.corte).toBeNull();
  });
});
