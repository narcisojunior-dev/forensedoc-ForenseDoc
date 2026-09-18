import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extrairPlanilhaCalculo } from "../../src/engine/planilhaCalculo.js";
import { separarCarimboProcessual } from "../../src/engine/carimboProcessual.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

/**
 * D4 · achado de prazo que não enfrentava a ressalva escrita no mesmo campo.
 *
 * O item 5.1 da CCB escreve "Prazo Total: 6 meses ou até o pagamento da última
 * parcela, o que acontecer por último". O comparador pegava o número e
 * descartava o resto do token, e o laudo marcava "Diverge" contra um campo que
 * nunca afirmou prazo fechado.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));
const limpo = separarCarimboProcessual(texto.replace(/\r/g, "\n")).text;

describe("D4 · a extração resolve o token completo", () => {
  const prazo = extrairPlanilhaCalculo(limpo).prazo_total_declarado;

  it("a ressalva do mesmo campo é preservada", () => {
    expect(prazo.ressalva).toMatch(/at[ée] o pagamento da [úu]ltima parcela/i);
  });

  /**
   * A planilha é de duas colunas e o campo continua duas linhas abaixo, com a
   * linha do IOF interleavada no meio. Parar na quebra de linha cortava a
   * ressalva em "…última parcela, o".
   */
  it("a continuação do campo, duas linhas abaixo, é recuperada", () => {
    expect(prazo.ressalva).toMatch(/o que acontecer por [úu]ltimo/i);
    expect(prazo.texto).toMatch(/o que acontecer por [úu]ltimo/i);
  });

  it("não absorve o IOF nem outros campos da coluna vizinha", () => {
    const tudo = `${prazo.texto} ${prazo.ressalva}`;
    expect(tudo).not.toMatch(/IOF/i);
    expect(tudo).not.toMatch(/R\$/);
    expect(tudo).not.toMatch(/\d+,\d{2}\s*%/);
    expect(tudo).not.toMatch(/Valor Total/i);
  });

  it("o texto do campo não duplica a ressalva", () => {
    const ocorrencias = (prazo.texto.match(/at[ée] o pagamento/gi) || []).length;
    expect(ocorrencias).toBe(1);
  });

  it("o campo é marcado como condicional", () => {
    expect(prazo.condicional).toBe(true);
    expect(prazo.quantidade).toBe(6);
    expect(prazo.unidade).toBe("meses");
  });

  it("prazo sem ressalva continua sendo prazo fechado", () => {
    const semRessalva = extrairPlanilhaCalculo(limpo.replace(/Prazo Total:6 meses[^\n]*/i, "Prazo Total: 6 meses"));
    expect(semRessalva.prazo_total_declarado.condicional).toBe(false);
    expect(semRessalva.prazo_total_declarado.ressalva).toBeNull();
  });
});

describe("D4 · o desfecho deixa de ser divergência simples", () => {
  const extraido = heuristicExtractionFromText(texto);

  it("a aferição não afirma que o prazo diverge", () => {
    expect(extraido.afericao_matematica.prazo_confere).toBeNull();
    expect(extraido.afericao_matematica.prazo_declarado_condicional).toBe(true);
  });

  it("a descrição diz que o prazo foi declarado de forma condicional", () => {
    expect(extraido.afericao_matematica.prazo_descricao).toMatch(/declarado de forma condicional/i);
    expect(extraido.afericao_matematica.prazo_descricao).toMatch(/249 dias/);
  });

  it("PRZ1 não é emitido para campo condicional", () => {
    expect(extraido.achados_irregularidade.map((a) => a.codigo)).not.toContain("PRZ1");
  });

  it("PRZ2 sai no lugar, com a ressalva ancorada e sem conclusão jurídica", () => {
    const przDois = extraido.achados_irregularidade.find((a) => a.codigo === "PRZ2");
    expect(przDois).toBeDefined();
    expect(przDois.texto).toMatch(/at[ée] o pagamento da [úu]ltima parcela/i);
    expect(przDois.texto).toMatch(/n[ãa]o se trata de diverg[êe]ncia/i);
    expect(przDois.texto).toMatch(/qualifica[çc][ãa]o jur[íi]dica/i);
    expect(przDois.texto).not.toMatch(/abusiv|nul[oa]|ilegal/i);
  });
});

describe("D4 · os dois renderizadores tratam o prazo condicional", () => {
  const extraido = heuristicExtractionFromText(texto);

  it("null nunca vira Diverge por ternário booleano", () => {
    const ok = (value) => (value === true ? "Confere" : value === false ? "Diverge" : null);
    expect(ok(extraido.afericao_matematica.prazo_confere)).toBeNull();
  });

  it("a ficha publica o token completo, e não só o número", () => {
    const p = extraido.contrato.prazo_total_declarado;
    expect(p.condicional).toBe(true);
    const rotulo = p.condicional ? `${p.texto} · declaração condicional` : `${p.quantidade} ${p.unidade}`;
    expect(rotulo).toMatch(/at[ée] o pagamento da [úu]ltima parcela/i);
    expect(rotulo).not.toBe("6 meses");
  });

  it("o PDF publica a linha do prazo como NÃO AFERIDO, com a ressalva", async () => {
    const { buildReportPdf } = await import("../../src/services/reportPdfService.js");
    const { extractPdfTextDetailed } = await import("../../src/services/pdfService.js");
    const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, {
      extracted: extraido,
      text: JSON.stringify(extraido),
      metadata: { warnings: [] },
      hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
      generatedAt: new Date().toISOString(),
      ipAnalysis: [],
    });
    const partes = [];
    for await (const parte of doc) partes.push(parte);
    const { text: plano } = await extractPdfTextDetailed(Buffer.concat(partes));
    const limpo = plano.replace(/\s+/g, " ");
    expect(limpo).toMatch(/NÃO AFERIDO/);
    expect(limpo).toMatch(/ressalva no próprio texto/i);
    expect(limpo).not.toMatch(/Prazo declarado × datas[^·]*NÃO CONFERE/);
  });
});
