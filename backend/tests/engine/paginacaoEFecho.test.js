import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { segmentarDocumentos, detectarAnomaliaPaginacao, temConteudoNegocial } from "../../src/engine/documentosLogicos.js";
import { separarCarimboProcessual } from "../../src/engine/carimboProcessual.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));
const limpo = separarCarimboProcessual(texto.replace(/\r/g, "\n")).text;

describe("D11 · duas contagens de página", () => {
  const segmentacao = segmentarDocumentos(limpo);
  const ccb = segmentacao.documentos.find((d) => d.tipo === "INSTRUMENTO_PRINCIPAL");

  it("a página de fecho é identificada", () => {
    expect(ccb.paginas_fecho).toBeGreaterThan(0);
    expect(ccb.paginas_conteudo_negocial).toBe(ccb.paginas_total - ccb.paginas_fecho);
  });

  it("a contagem total permanece a do arquivo", () => {
    expect(ccb.paginas_total).toBe(ccb.paginaFinal - ccb.paginaInicial + 1);
  });

  it("página só com cabeçalho e rodapé não tem conteúdo negocial", () => {
    expect(temConteudoNegocial("www.banco.com.br    9h às 18h    SAC 24H: 0800 770 6211\nVIA NÃO NEGOCIÁVEL (VIA DO CLIENTE)")).toBe(false);
  });

  /** Na dúvida a página conta como negocial: subestimar enfraquece o achado. */
  it("página com cláusula conta como negocial", () => {
    const clausula = "11.1. A eficácia desta cédula fica sujeita à condição suspensiva consistente na disponibilidade e averbação de margem consignável junto ao empregador do emitente, na forma da legislação aplicável.";
    expect(temConteudoNegocial(clausula)).toBe(true);
  });

  it("o achado de tempo por página declara as duas contagens", () => {
    const extraido = heuristicExtractionFromText(texto);
    const trl1 = (extraido.achados_irregularidade || []).find((a) => /^TRL1/.test(a.codigo) && /fecho/.test(a.texto || ""));
    if (trl1) {
      expect(trl1.texto).toMatch(/conte[úu]do negocial/i);
      expect(trl1.texto).toMatch(/m[ée]trica [ée] calculada sobre o total/i);
    }
  });
});

describe("D12 · anomalia de paginação como indício", () => {
  it("detecta numerador acima do denominador declarado", () => {
    const anomalias = detectarAnomaliaPaginacao(limpo);
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0].denominador).toBe(5);
    expect(anomalias[0].maior_numerador).toBe(7);
    expect(anomalias[0].paginas[0]).toBe(8);
    expect(anomalias[0].paginas.at(-1)).toBe(14);
  });

  it("numeração coerente não produz achado", () => {
    const coerente = ["CG.MOD1.2025    1/3", "CG.MOD1.2025    2/3", "CG.MOD1.2025    3/3"].join("\n\f\n");
    expect(detectarAnomaliaPaginacao(coerente)).toEqual([]);
  });

  /** O estado é indício, nunca comprovado. */
  it("o achado sai como indício e não conclui adulteração", () => {
    const extraido = heuristicExtractionFromText(texto);
    const pag1 = (extraido.achados_irregularidade || []).find((a) => a.codigo === "PAG1");
    expect(pag1).toBeDefined();
    expect(pag1.texto).toMatch(/constatada no arquivo.*ind[íi]cio, n[ãa]o comprova[çc][ãa]o/i);
    expect(pag1.texto).not.toMatch(/adultera|fraude|falsific/i);
  });
});

describe("D11 · fecho é moldura sem texto, não página curta", () => {
  /**
   * Um limiar de tamanho trata página curta como página vazia. A contagem de
   * conteúdo negocial existe para ANTECIPAR o argumento da defesa; classificar
   * cláusula curta como fecho daria munição a ele.
   */
  it("cláusula curta é conteúdo negocial", () => {
    expect(temConteudoNegocial("O contratante autoriza o desconto das parcelas em sua folha de pagamento.")).toBe(true);
  });

  it("cláusula curta ao lado da moldura continua sendo conteúdo", () => {
    const pagina = [
      "www.c6consig.com.br    9h às 18h    SAC 24H: 0800 770 6211",
      "O contratante autoriza o desconto das parcelas em sua folha de pagamento.",
    ].join("\n");
    expect(temConteudoNegocial(pagina)).toBe(true);
  });

  it("moldura sozinha é fecho", () => {
    const pagina = [
      "VIA NÃO NEGOCIÁVEL (VIA DO CLIENTE)",
      "www.c6consig.com.br    9h às 18h    SAC 24H: 0800 770 6211",
      "Documento assinado digitalmente - TJAM",
    ].join("\n");
    expect(temConteudoNegocial(pagina)).toBe(false);
  });

  /** Sem moldura reconhecida não se classifica: na dúvida, conteúdo. */
  it("página sem moldura reconhecida não é fecho, mesmo curta", () => {
    expect(temConteudoNegocial("Anexo II")).toBe(true);
  });
});

describe("caminho integrado · form-feed terminal", () => {
  /**
   * A extração do Poppler emite form-feed no fim do arquivo. Passado cru ao
   * segmentador, o dossiê de 27 páginas virava 28.
   */
  it("form-feed terminal não cria página a mais", () => {
    const comTerminador = segmentarDocumentos(`${limpo}\f`);
    const semTerminador = segmentarDocumentos(limpo);
    expect(comTerminador.documentos.at(-1).paginaFinal).toBe(27);
    expect(comTerminador.documentos.at(-1).paginaFinal).toBe(semTerminador.documentos.at(-1).paginaFinal);
  });

  it("os Termos de Uso têm 10 páginas, não 11", () => {
    const termos = segmentarDocumentos(`${limpo}\f`).documentos.find((d) => d.tipo === "TERMOS");
    expect(termos.paginas_total).toBe(10);
    expect(termos.paginaInicial).toBe(18);
    expect(termos.paginaFinal).toBe(27);
  });
});
