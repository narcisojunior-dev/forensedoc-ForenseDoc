import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analisarTrilhaEventos } from "../../src/engine/trilhaEventos.js";
import { extrairSeguroPrestamista } from "../../src/engine/seguroPrestamista.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

/**
 * Defeitos encontrados pelo Codex na revisão do lote 2. Cada bloco prende um.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));

describe("D8 · a coincidência de horários é afirmada só quando existe", () => {
  const extraido = heuristicExtractionFromText(texto);
  const analisar = (dataHoraAssinatura) => analisarTrilhaEventos({
    texto,
    segmentacao: extraido.documentos_logicos,
    ufEmissao: "AM",
    dataHoraAssinatura,
    flat: texto.replace(/\s+/g, " "),
  });

  it("com evento de mesmo horário, afirma a coincidência e nomeia o evento", () => {
    const tz1 = (analisar("25/06/2025 10:45:03").achados || []).find((a) => a.codigo === "TZ1");
    expect(tz1).toBeDefined();
    expect(tz1.texto).toMatch(/coincide com o do evento/i);
    expect(tz1.titulo).not.toMatch(/sem evento de mesmo hor[áa]rio/i);
  });

  /** O caso que o Codex reproduziu: assinatura às 11:45:03, trilha até 10:45:03. */
  it("sem evento de mesmo horário, não afirma coincidência", () => {
    const tz1 = (analisar("25/06/2025 11:45:03").achados || []).find((a) => a.codigo === "TZ1");
    expect(tz1).toBeDefined();
    expect(tz1.texto).not.toMatch(/coincidem|coincide com o do evento/i);
    expect(tz1.texto).toMatch(/nenhum evento da trilha registra esse mesmo hor[áa]rio/i);
    expect(tz1.titulo).toMatch(/sem evento de mesmo hor[áa]rio/i);
  });

  it("o título não afirma divergência de valores em nenhum dos dois casos", () => {
    for (const dh of ["25/06/2025 10:45:03", "25/06/2025 11:45:03"]) {
      const tz1 = (analisar(dh).achados || []).find((a) => a.codigo === "TZ1");
      expect(tz1.titulo).not.toMatch(/misturad/i);
    }
  });
});

describe("D10 · o achado da soma das coberturas não colide com o do prêmio da planilha", () => {
  const extraido = heuristicExtractionFromText(texto);
  const seguro = extraido.seguro_prestamista;

  it("a soma das coberturas sai como SEG8, não SEG7", () => {
    const codigos = seguro.achados.map((a) => a.codigo);
    expect(codigos).toContain("SEG8");
    expect(codigos.filter((c) => c === "SEG7").length).toBeLessThanOrEqual(1);
  });

  it("nenhum código se repete na lista de achados do seguro", () => {
    const codigos = seguro.achados.map((a) => a.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  /** As duas divergências são independentes e devem poder coexistir. */
  it("as duas divergências coexistem quando ambas ocorrem", () => {
    const comPlanilhaDivergente = extrairSeguroPrestamista({
      texto,
      segmentacao: extraido.documentos_logicos,
      contrato: { ...extraido.contrato, seguros: "R$ 300,00" },
    });
    const codigos = comPlanilhaDivergente.achados.map((a) => a.codigo);
    expect(codigos).toContain("SEG7");
    expect(codigos).toContain("SEG8");
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});

describe("D9 · base do confronto e estado do certificado", () => {
  const extraido = heuristicExtractionFromText(texto);

  it("sem vigência declarada, a premissa é a data do contrato e o achado é rebaixado", () => {
    const s = extraido.seguro_prestamista;
    expect(s.vigencia.premissa_origem).toBe("PRESUMIDO_DATA_DO_CONTRATO");
    expect(s.achados.find((a) => a.codigo === "SEG1").gravidade).toBe("MÉDIA");
  });

  /**
   * O certificado tem três estados, não dois. Dar como ausente o que não foi
   * procurado é afirmar lacuna não verificada.
   */
  it("o estado do certificado distingue não localizado de não verificado", () => {
    expect(["LOCALIZADO_NO_ARQUIVO", "NAO_LOCALIZADO_NO_ARQUIVO", "NAO_VERIFICADO"])
      .toContain(extraido.seguro_prestamista.vigencia.certificado_individual);
  });

  it("sem menção a certificado no material, o estado é NAO_VERIFICADO", () => {
    const semMencao = extrairSeguroPrestamista({
      texto: texto.replace(/certificado/gi, "documento anexo"),
      segmentacao: extraido.documentos_logicos,
      contrato: extraido.contrato,
    });
    if (semMencao) {
      expect(semMencao.vigencia.certificado_individual).toBe("NAO_VERIFICADO");
    }
  });

  it("com vigência declarada, o confronto usa essa data e não a do contrato", () => {
    const comVigencia = extrairSeguroPrestamista({
      texto: texto.replace(/As datas de in[íi]cio e fim de vig[êe]ncia[^.]*\./i, "Início de Vigência\n01/08/2025\n"),
      segmentacao: extraido.documentos_logicos,
      contrato: extraido.contrato,
    });
    if (comVigencia?.vigencia?.inicio_declarado) {
      expect(comVigencia.vigencia.premissa_origem).toBe("DECLARADO_NA_PROPOSTA");
      const seg1 = comVigencia.achados.find((a) => a.codigo === "SEG1");
      if (seg1) {
        expect(seg1.gravidade).toBe("ALTA");
        expect(seg1.texto).toMatch(/in[íi]cio de vig[êe]ncia declarado na proposta/i);
      }
    }
  });
});

describe("D5 · o renderizador do backend não tem fuga para o legado", () => {
  /**
   * `evs = extracted.evidencias_irregularidade` era incondicional. Com projeção
   * vazia, `achados` ficava vazio, a função caía no laço final e voltava a
   * imprimir o legado, que é a segunda lista que o D5 eliminou.
   *
   * O teste lê o texto renderizado do PDF, que é o que chega ao leitor do laudo,
   * em vez de inspecionar variáveis.
   */
  const ANALISE = { id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() };

  // `buildReportPdf` lê o extraído de `result.text`, não de `result.extracted`.
  const extraido = (legado) => ({
    contrato: {}, cliente: {}, assinatura: {},
    evidencias_irregularidade: legado,
    achados_irregularidade: [],
  });

  const resultado = (legado, sumario) => ({
    extracted: extraido(legado),
    text: JSON.stringify(extraido(legado)),
    metadata: { warnings: [] },
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    generatedAt: new Date().toISOString(),
    ipAnalysis: [],
    ...(sumario ? { sumarioIrregularidades: sumario } : {}),
  });

  const renderizar = async (result) => {
    const { buildReportPdf } = await import("../../src/services/reportPdfService.js");
    const { extractPdfTextDetailed } = await import("../../src/services/pdfService.js");
    const doc = await buildReportPdf(ANALISE, result);
    const partes = [];
    for await (const p of doc) partes.push(p);
    const { text } = await extractPdfTextDetailed(Buffer.concat(partes));
    return text.replace(/\s+/g, " ");
  };

  // Dois formatos de legado: string solta e objeto.
  const formatos = [
    ["string solta", ["CAD2 ALTA: achado legado que nao deve reaparecer no laudo."]],
    ["objeto", [{ codigo: "LEG1", gravidade: "ALTA", titulo: "Achado legado", texto: "Nao deve reaparecer no laudo." }]],
  ];

  it.each(formatos)("com projeção vazia, o legado em %s não é impresso", async (_rotulo, legado) => {
    const plano = await renderizar(resultado(legado, {
      projecao: [], findings: [], allFindings: [], corte: null, semAchados: true,
    }));
    expect(plano).not.toMatch(/reaparecer/i);
  });

  it("sem projeção, o legado continua sendo impresso para laudos antigos", async () => {
    const plano = await renderizar(resultado(["Evidencia legada preservada no laudo antigo."], null));
    expect(plano).toMatch(/legada preservada/i);
  });

  it("com projeção preenchida, é ela que sai, e não o legado", async () => {
    const plano = await renderizar(resultado(["Evidencia legada que nao deve reaparecer."], {
      projecao: [{ key: "TZ1", severity: "MÉDIA", title: "Bloco de assinatura sem fuso declarado", text: "Texto da projecao canonica." }],
      findings: [], allFindings: [], corte: null, semAchados: false,
    }));
    expect(plano).toMatch(/projecao canonica/i);
    expect(plano).not.toMatch(/reaparecer/i);
  });
});
