import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

/**
 * O PDF do servidor leva o que a tela de análise exibe.
 *
 * A tela (frontend/src/laudo/LaudoForense.jsx) e o PDF (reportPdfService.js)
 * leem o mesmo resultado persistido, mas o PDF deixava de fora boa parte do que
 * a tela mostrava: confronto de hash, metadados, dados do contrato e do
 * contratante, campos do certificado, auditoria do trilho de acesso, imagens
 * relevantes, confronto com o processo, cabeçalho e régua do sumário. Este
 * teste tranca as duas pontas: as regras de apresentação copiadas para o
 * servidor continuam iguais às da tela, e os dados chegam ao texto do PDF.
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
const servidor = await import("../src/reports/laudoApresentacao.js");
const tela = await import("../../frontend/src/laudo/laudoUtils.js");
const { montarRelatorio } = await import("../../frontend/src/laudo/montarRelatorio.js");

async function textoDoPdf(result) {
  const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result);
  const partes = [];
  for await (const p of doc) partes.push(p);
  const parser = new PDFParse({ data: Buffer.concat(partes) });
  try {
    const { text } = await parser.getText();
    return text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

const TRILHA_ACESSO = {
  events: [
    { action: "Documento criado", date: "25/06/2025", time: "10:41:39", ip: "177.104.55.201", port: "50112", lat: -3.43401, lon: -60.45932, device: "Android 10 / Chrome" },
    { action: "Selfie capturada", date: "25/06/2025", time: "10:44:10", ip: "177.104.55.201", port: "50113", lat: -3.43405, lon: -60.4594, device: "Android 10 / Chrome" },
    { action: "Finalizado", date: "25/06/2025", time: "10:45:03", ip: "177.104.55.201", port: "50115", lat: -3.4341, lon: -60.4595, device: "Android 10 / Chrome" },
  ],
  eventCount: 3,
  uniqueIps: ["177.104.55.201"],
  ports: ["50112", "50113", "50115"],
  coordinateCount: 3,
  eventTimezone: "-03:00",
  device: "Android 10 / Chrome",
  deviceIdentifiable: false,
  chronologyInconsistent: false,
  northSouthMeters: 10.1,
  eastWestMeters: 20.2,
};

async function resultCompleto() {
  const caso = JSON.parse(await readFile(new URL("./corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
  const extracted = heuristicExtractionFromText(caso.texto);
  extracted.trilha_acesso = TRILHA_ACESSO;
  extracted.contrato = { ...extracted.contrato, codigo_banco_bacen: "626", data_primeiro_vencimento: "01/10/2025", data_ultimo_vencimento: "01/03/2026" };
  extracted.cliente = { ...extracted.cliente, bairro: "CENTRO", banco_recepcao: "Banco Bradesco S.A." };
  extracted.imagens_pdf = {
    disponivel: true,
    total: 2,
    extraidas: 2,
    grupos_repetidos: [],
    achados: [],
    imagens: [
      { page: 1, num: 12, type: "image", width: 360, height: 640, classificacao: "fotografia/biometria provável", size: "38.4K", sha256: "8".repeat(64), biometricaProvavel: true },
      { page: 2, num: 1, type: "image", width: 9, height: 9, classificacao: "logotipo/template", size: "12B", sha256: "2".repeat(64) },
    ],
  };
  const ipAnalysis = [{
    endereco: "177.104.55.201", porta: "50112", versao: 4, classe: "PUBLICO", contexto: "Registrado como IP de origem",
    data_hora: "25/06/2025 10:45:03", user_agent: "Mozilla/5.0 (Linux; Android 10)",
    geo: { lat: -3.119, lon: -60.0217, city: "Manaus", region: "AM", country: "BR", timezone: "America/Manaus", isp: "Operadora X" },
  }];
  const result = {
    text: JSON.stringify(extracted),
    warning: "OCR aplicado em 2 páginas com baixa legibilidade.",
    metadata: {
      version: "1.4", totalPages: 27, pageFormats: ["209.9 x 297.0 mm"], producer: "iText",
      creationDate: "20/07/2026 20:08:50", modificationDate: "21/07/2026 09:00:00",
      trailerFingerprint: "4680d7011b0f4f716547e42c778af86d", warnings: [],
      digitalSignature: {
        estado: "PRESENTE",
        catalog: {
          acroform: "PRESENTE", acroformXref: 12, sigFlags: 3, incrementalUpdates: 1, eofCount: 2,
          fields: [{ xref: 40, nome: "Signature1", rect: "0 0 0 0", invisivel: true, assinado: true, dicionario_sig: 41, data_declarada: "25/06/2025 10:45:10", subfilter: "ETSI.CAdES.detached" }],
        },
        pdfsig: { disponivel: true, assinaturas: [{ numero: 1, campo: "Signature1", signatario_cn: "BANCO C6", signatario_dn: "CN=BANCO C6,O=ICP-Brasil", subfilter: "ETSI.CAdES.detached", bytesCobertos: 1000, coberturaPercentual: 99.9, notTotalDocumentSigned: true }] },
        alerts: [],
      },
    },
    reportId: "FD-20260918-AAAAAAAAAA",
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    file: { name: "dossie.pdf", sizeBytes: 1_093_194 },
    generatedAt: new Date().toISOString(),
    home: null,
    contractGeo: null,
    ipAnalysis,
    cadeiaCustodia: buildCustodyChain(extracted, ipAnalysis, false),
  };
  result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
  return result;
}

describe("regras de apresentação: servidor igual à tela", () => {
  const achados = [
    { codigo: "LIB1", gravidade: "ALTA", titulo: "Ausência de comprovante.", texto: "x" },
    { codigo: "FIN3", gravidade: "INFO", titulo: "Carência prolongada", texto: "y" },
    { codigo: "SEG1", gravidade: "INFO", titulo: "Seguro", texto: "carência e franquia" },
    { codigo: "CAD4", gravidade: "MÉDIA", titulo: "Cadastro", texto: "z" },
  ];

  it("lista, ordena e agrupa os achados da mesma forma", () => {
    const projecao = achados.map((a) => ({ key: a.codigo, severity: a.gravidade, title: a.titulo, text: a.texto }));
    expect(servidor.reportIssues({}, projecao)).toEqual(tela.reportIssues({}, projecao));
    expect(servidor.reportIssues({ achados_irregularidade: achados })).toEqual(tela.reportIssues({ achados_irregularidade: achados }));
    expect(servidor.reportIssues({ evidencias_irregularidade: ["Achado antigo. Detalhe."] })).toEqual(tela.reportIssues({ evidencias_irregularidade: ["Achado antigo. Detalhe."] }));
    for (const a of achados) expect(servidor.issueBucket(a)).toBe(tela.issueBucket(a));
  });

  it("redige a nota do hash e classifica o hash declarado da mesma forma", () => {
    const assinatura = { codigo_autenticacao_declarado: "f0a1", codigo_autenticacao_origem: "rótulo \"Número único\", pág. 2" };
    for (const estado of ["AUSENTE", "DECLARADO_NAO_CONFERIVEL", "DECLARADO_CONFERIVEL"]) {
      expect(servidor.noteForDeclaredHashState(estado, "ABC", null)).toBe(tela.noteForDeclaredHashState(estado, "ABC", null));
    }
    expect(servidor.noteForDeclaredHashState("AUSENTE", "ABC", assinatura)).toBe(tela.noteForDeclaredHashState("AUSENTE", "ABC", assinatura));
    for (const h of ["a".repeat(64), "b".repeat(40), "123e4567-e89b-42d3-a456-426614174000", "xyz"]) {
      expect(servidor.classifyHashString(h).format).toBe(tela.classifyHashString(h).format);
    }
  });

  it("saneia o sumário legado como a tela", () => {
    const sumario = {
      findings: [{ key: "gps-near-home", severity: "FAVORÁVEL", title: "t", text: "0,00 km" }, { key: "LIB1", severity: "ALTA", title: "t", text: "x" }],
      allFindings: [{ key: "gps-near-home" }, { key: "LIB1" }],
      favorable: [{ key: "gps-near-home" }],
      checks: [{ key: "gps-residencia", status: "OK" }],
      ipCards: [{ endereco: "1.1.1.1", text: "Manaus, 12,5 km da referência residencial" }],
      geo: { items: [{ label: "x", distance: 0 }] },
    };
    const home = { estado_confronto: "RECUSADO_CONFLITO" };
    const esperado = montarRelatorio({ analysisId: "a", result: { sumarioIrregularidades: sumario, home, ipAnalysis: [] } }).sumarioIrregularidades;
    expect(servidor.sanearSumario(sumario, home, [], null)).toEqual(esperado);
  });
});

describe("o PDF leva os dados exibidos na tela", () => {
  it("imprime as seções e os campos que antes ficavam só na tela", async () => {
    const texto = await textoDoPdf(await resultCompleto());
    for (const trecho of [
      "Nota de processamento",
      "OCR aplicado em 2 páginas",
      // § 1.1: a data de modificação vinha de uma chave inexistente.
      "Data de modificação interna: 21/07/2026 09:00:00",
      "Identificador interno do trailer",
      "Versão do formato PDF: 1.4",
      // § 1.2: catálogo e pdfsig completos.
      "Campos de assinatura no catálogo do PDF",
      "DN completo: CN=BANCO C6,O=ICP-Brasil",
      "Documento integral assinado: Não",
      // § 2 e § 3.
      "Código BACEN: 626",
      "Primeiro vencimento: 01/10/2025",
      "Bairro: CENTRO",
      // § 4.2: auditoria do trilho de acesso.
      "Auditoria da assinatura e do trilho de acesso",
      "Histórico de ações completo (3 eventos)",
      "Android 10 / Chrome",
      "Dispersão das coordenadas",
      "Leitura forense",
      "Diligências sugeridas",
      // § 4.4: imagens relevantes.
      "Imagens, selfie e prova de vida",
      "Imagens relevantes para a perícia",
      // § 5.3: contexto, classe e fuso do IP.
      "Classe técnica: PUBLICO",
      "Fuso horário: America/Manaus",
      // § 6.1 sempre presente, § 9 com a síntese normativa.
      "Não foi anexado PDF do processo",
      "Achados deste laudo com maior aderência normativa",
    ]) {
      expect(texto, trecho).toContain(trecho);
    }
  });

  it("confronta o hash declarado com o calculado, como a tela", async () => {
    const result = await resultCompleto();
    const extracted = JSON.parse(result.text);
    extracted.assinatura = { ...extracted.assinatura, hash_documento_assinado: "a".repeat(64), algoritmo_hash: "SHA-256" };
    result.text = JSON.stringify(extracted);
    result.cadeiaCustodia = buildCustodyChain(extracted, result.ipAnalysis, false);
    result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
    const texto = await textoDoPdf(result);
    expect(texto).toContain("Confronto · hash informado × hash encontrado");
    expect(texto).toContain("Resultado da comparação: HASHES CONFEREM");
  });
});
