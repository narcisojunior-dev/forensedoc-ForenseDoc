import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * O laudo verifica e valida cadeia de custódia.
 *
 * As condições econômicas da operação (valores, tarifas, tributos, taxas, CET e
 * prazos) saíram do documento, e com elas os achados, as verificações e as
 * diligências que só existiam pelo exame econômico. O motor continua extraindo
 * e gravando tudo: o corte é de apresentação, e vale também para laudos já
 * emitidos, que saem sem os valores ao serem reexportados.
 *
 * O laudo também deixou de se identificar por escritório e inscrição na OAB:
 * quem responde pelo método e pelo resultado é o ForenseDoc.
 */

vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
  mapPointsDeclaredVsIp: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { buildSummaryForResult } = await import("../src/services/analysisRecompute.js");
const { buildCustodyChain } = await import("../src/reports/custodyChain.js");
const { extractPdfTextDetailed } = await import("../src/services/pdfService.js");
const servidor = await import("../src/reports/laudoApresentacao.js");
const tela = await import("../../frontend/src/laudo/laudoUtils.js");

async function laudoDoDossie() {
  const caso = JSON.parse(await readFile(new URL("./corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
  const extracted = heuristicExtractionFromText(caso.texto);
  const ipAnalysis = [];
  const result = {
    text: JSON.stringify(extracted),
    metadata: { warnings: [] },
    reportId: "FD-20260919-AAAAAAAAAA",
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    file: { name: "dossie.pdf", sizeBytes: 1_000_000 },
    generatedAt: new Date().toISOString(),
    home: null,
    contractGeo: null,
    ipAnalysis,
    cadeiaCustodia: buildCustodyChain(extracted, ipAnalysis, false),
  };
  result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
  const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result);
  const partes = [];
  for await (const parte of doc) partes.push(parte);
  const { text } = await extractPdfTextDetailed(Buffer.concat(partes));
  return { texto: text.replace(/\s+/g, " "), extracted, result };
}

describe("o laudo não publica as condições econômicas da operação", () => {
  it("o dossiê traz valores e o PDF sai sem nenhum deles", async () => {
    const { texto, extracted } = await laudoDoDossie();
    // Guarda do próprio teste: se a extração parar de ler valores, o resto
    // passaria por vacuidade.
    expect(extracted.contrato.valor_liberado).toMatch(/R\$/);
    expect(texto).not.toMatch(/R\$/);
    for (const proibido of [
      /Valor liberado/i,
      /Valor da parcela/i,
      /Somatório das parcelas/i,
      /Tarifa de cadastro/i,
      /IOF/,
      /\bCET\b/,
      /Taxa de juros/i,
      /Aferição matemática/i,
      /Custo total/i,
      /Pró-labore/i,
      /Prêmio/,
    ]) {
      expect(texto, String(proibido)).not.toMatch(proibido);
    }
  });

  it("mantém no laudo o que sustenta a cadeia de custódia", async () => {
    const { texto } = await laudoDoDossie();
    for (const esperado of [
      "§ 2 · Dados do instrumento contratual",
      "As condições econômicas da operação",
      "§ 4 · Assinatura eletrônica e cadeia de custódia",
      "Número do contrato",
      "Data do contrato",
      // Do seguro fica a estrutura da apólice; prêmio e pró-labore saíram.
      "Seguro prestamista vinculado à operação",
    ]) {
      // Títulos saem em versalete no desenho do laudo; o teste é do dado.
      expect(texto, esperado).toMatch(new RegExp(esperado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }
    expect(texto).not.toMatch(/Demonstrativo de cálculo do CET/i);
    expect(texto).not.toMatch(/recolhimento do IOF/i);
    expect(texto).not.toMatch(/campo de valor liberado ao cliente/i);
  });

  it("identifica o laudo pelo ForenseDoc, sem escritório nem inscrição na OAB", async () => {
    const { texto } = await laudoDoDossie();
    expect(texto).toContain("FORENSEDOC");
    expect(texto).not.toMatch(/Ronney/i);
    expect(texto).not.toMatch(/OAB\//);
  });
});

describe("o corte do eixo financeiro é igual no servidor e na tela", () => {
  const projecao = [
    { key: "INT1", severity: "MÉDIA", title: "Código de autenticação inverificável", text: "a" },
    { key: "CET1", severity: "ALTA", title: "Demonstrativo do CET ausente", text: "b" },
    { key: "FIN2", severity: "MÉDIA", title: "Valor liberado em branco", text: "c" },
    { key: "TRB1", severity: "MÉDIA", title: "IOF sem demonstrativo", text: "d" },
    { key: "TAR1", severity: "INFO", title: "Tarifa de emissão", text: "e" },
    { key: "economics-missing", severity: "ALTA", title: "Sem os números do negócio", text: "f" },
    // Data de contratação divergente é cronologia, não preço: continua no laudo.
    { key: "DAT1", severity: "MÉDIA", title: "Datas de contratação divergentes", text: "g" },
  ];

  it("achados de valor, taxa e custo saem da lista do § de achados", () => {
    for (const mod of [servidor, tela]) {
      const codigos = mod.reportIssues({}, projecao).map((i) => i.codigo);
      expect(codigos).toEqual(["INT1", "DAT1"]);
    }
    expect(servidor.reportIssues({}, projecao)).toEqual(tela.reportIssues({}, projecao));
  });

  it("o caminho legado, de laudos antigos, recebe o mesmo corte", () => {
    const legado = { achados_irregularidade: projecao.map((f) => ({ codigo: f.key, gravidade: f.severity, titulo: f.title, texto: f.text })) };
    expect(servidor.reportIssues(legado).map((i) => i.codigo)).toEqual(["INT1", "DAT1"]);
    expect(servidor.reportIssues(legado)).toEqual(tela.reportIssues(legado));
  });

  it("o sumário perde a verificação e as diligências econômicas, e mantém as demais", () => {
    const sumario = {
      findings: [{ key: "CET1", severity: "ALTA", title: "t", text: "x" }, { key: "INT1", severity: "MÉDIA", title: "t", text: "y" }],
      allFindings: [{ key: "CET1" }, { key: "INT1" }],
      favorable: [{ key: "economics-missing" }, { key: "hash-ok" }],
      checks: [{ key: "dados-economicos", status: "ALERTA" }, { key: "hash", status: "ALERTA" }],
      diligences: [
        { key: "cet-demo", title: "Demonstrativo de cálculo do CET", text: "Exigir valor em reais" },
        { key: "iof-proof", title: "Comprovante de recolhimento do IOF", text: "Exigir base de cálculo" },
        { key: "full-contract", title: "Instrumento contratual completo", text: "Solicitar taxa anual quando o campo estiver em branco, campo de valor liberado ao cliente, demonstrativo do CET." },
        { key: "payload", title: "Payload original assinado", text: "Solicitar o arquivo original" },
      ],
    };
    const saneado = servidor.sanearSumario(sumario, null, [], null);
    expect(saneado.findings.map((f) => f.key)).toEqual(["INT1"]);
    expect(saneado.allFindings.map((f) => f.key)).toEqual(["INT1"]);
    expect(saneado.favorable.map((f) => f.key)).toEqual(["hash-ok"]);
    expect(saneado.checks.map((c) => c.key)).toEqual(["hash"]);
    expect(saneado.diligences.map((d) => d.key)).toEqual(["full-contract", "payload"]);
    expect(saneado.diligences[0].text).not.toMatch(/CET|valor liberado|taxa anual/);
  });
});
