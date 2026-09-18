import { describe, it, expect, vi } from "vitest";
import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";

/**
 * Paginação do laudo: nenhuma folha em branco, em nenhuma combinação de dados.
 *
 * O defeito que este teste tranca era estrutural, não cosmético. As guardas de
 * quebra mediam cada bloco isoladamente e não perguntavam se a página atual já
 * tinha conteúdo, então um bloco mais alto do que a área útil abria uma folha,
 * reavaliava a mesma guarda no topo dela e abria a seguinte — a primeira saía
 * vazia. Pela mesma razão, uma figura que o PDFKit não conseguisse decodificar
 * deixava para trás a página que a reserva tinha acabado de abrir.
 *
 * A invariante que fecha a classe inteira é uma só: só se quebra página que já
 * recebeu alguma coisa. É ela que o teste verifica, a cada quebra, em vez de
 * conferir o número de páginas de um laudo específico — que muda a cada ajuste
 * de redação e não prova nada sobre o próximo documento.
 */

let mapaFalso = null;
vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => mapaFalso),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
  mapPointsDeclaredVsIp: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { buildSummaryForResult } = await import("../src/services/analysisRecompute.js");
const { buildCustodyChain } = await import("../src/reports/custodyChain.js");

/** Gera o laudo vigiando cada quebra de página feita pelo gerador. */
async function gerarVigiando(result) {
  const quebras = [];
  const original = PDFDocument.prototype.addPage;
  PDFDocument.prototype.addPage = function (...args) {
    if (this.page) {
      quebras.push({
        y: this.y,
        topo: this.page.margins.top,
        sobra: this.page.height - this.page.margins.bottom - this.y,
        util: this.page.height - this.page.margins.top - this.page.margins.bottom,
      });
    }
    return original.apply(this, args);
  };
  try {
    const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result);
    const partes = [];
    for await (const p of doc) partes.push(p);
    return { bytes: Buffer.concat(partes), quebras };
  } finally {
    PDFDocument.prototype.addPage = original;
  }
}

/**
 * Laudo longo, montado sobre o dossiê do corpus de regressão.
 *
 * O tamanho é o ponto: laudo curto não exercita seção que começa no alto da
 * página, e foi justamente aí que a folha quase vazia aparecia. O confronto
 * geográfico é preenchido à mão porque os serviços externos não entram em teste.
 */
async function resultDeExemplo() {
  const caso = JSON.parse(
    await readFile(new URL("./corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8")
  );
  const extracted = heuristicExtractionFromText(caso.texto);
  const home = {
    query: "Manaquiri - AM, 69435-000",
    source: "cadastro",
    geo: { lat: -3.9148823, lon: -60.8609358, display: "Manaquiri, AM, Brasil", precision: "city" },
  };
  const contractGeo = {
    lat: -3.4340189, lon: -60.4593232, fonte: "log de assinatura", precision: "gps",
    distance: 73.4, municipio: "Manaquiri", uf: "AM", dataHora: "25/06/2025 10:45:03",
  };
  const ipAnalysis = [{
    endereco: "177.104.55.201", porta: "51234", versao: 4, data_hora: "25/06/2025 10:45:03",
    geo: { lat: -3.1190, lon: -60.0217, city: "Manaus", region: "AM", country: "BR" },
    divergenciaResidencia: {
      km: 73.4, rotulo: "RISCO MÉDIO", tom: "warn", nivel: "divergente",
      sintese: "A conexão partiu de município distinto do da residência informada.",
    },
    divergenciaAssinatura: {
      km: 2.1, rotulo: "COMPATÍVEL", tom: "ok",
      sintese: "A origem da conexão e a geolocalização declarada estão na mesma região urbana.",
    },
  }];
  const result = {
    text: JSON.stringify(extracted),
    metadata: {
      totalPages: 27, author: "PROJUDI", creator: "TJAM", producer: "iText",
      creationDate: "2025-10-28", modDate: "2025-10-28", warnings: [],
    },
    reportId: "FD-20260916-AAAAAAAAAA",
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    file: { name: "dossie.pdf", sizeBytes: 1_093_194 },
    generatedAt: new Date().toISOString(),
    home, contractGeo, ipAnalysis, geoDeclaredPresent: true,
    cadeiaCustodia: buildCustodyChain(extracted, ipAnalysis, true),
  };
  result.sumarioIrregularidades = buildSummaryForResult(result, extracted);
  return result;
}

/** Quebrar uma página intacta é a definição operacional de folha em branco. */
function conferirQueNenhumaFolhaSaiuVazia(quebras) {
  for (const q of quebras) expect(q.y).toBeGreaterThan(q.topo + 1);
}

describe("paginação do laudo em PDF", () => {
  it("nunca quebra uma página que ainda está vazia", async () => {
    const { bytes, quebras } = await gerarVigiando(await resultDeExemplo());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(quebras.length).toBeGreaterThan(0);
    conferirQueNenhumaFolhaSaiuVazia(quebras);
  });

  it("não deixa folha vazia quando a imagem do mapa não pode ser decodificada", async () => {
    mapaFalso = Buffer.from("isto não é um PNG");
    try {
      const { bytes, quebras } = await gerarVigiando(await resultDeExemplo());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      conferirQueNenhumaFolhaSaiuVazia(quebras);
    } finally {
      mapaFalso = null;
    }
  });

  it("não deixa folha vazia no laudo antigo, sem nenhum campo do motor", async () => {
    const { quebras } = await gerarVigiando({
      text: JSON.stringify({ cliente: { nome: "FULANO" }, evidencias_irregularidade: ["Achado antigo."] }),
      metadata: { warnings: [] },
      hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
      file: { name: "contrato.pdf", sizeBytes: 1024 },
      generatedAt: new Date().toISOString(),
      ipAnalysis: [],
    });
    conferirQueNenhumaFolhaSaiuVazia(quebras);
  });

  it("aproveita a folha: nenhuma quebra descarta mais da metade da altura útil", async () => {
    // A exceção legítima é a figura que não se parte; fora dela, sobra grande é
    // guarda mal calibrada, que foi exatamente o defeito corrigido.
    const { quebras } = await gerarVigiando(await resultDeExemplo());
    for (const q of quebras) expect(q.sobra).toBeLessThan(q.util * 0.5);
  });
});
