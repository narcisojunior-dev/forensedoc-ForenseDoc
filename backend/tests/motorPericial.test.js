import { describe, it, expect } from "vitest";
import { makeSearchablePdf } from "./helpers/pdfDeTeste.js";
import {
  enderecoInstitucional, enderecoNaoInformado, enderecoPorColunas, extrairIps, nomePlausivel, valorEhRotulo,
} from "../src/engine/salvaguardas.js";
import { heuristicExtractionFromText } from "../src/services/extractionService.js";
import { analisarDocumento } from "../src/engine/analisarDocumento.js";
import { extractPdfMetadata } from "../src/services/pdfService.js";
import { extractPdfTextWithOcr, faixasDeOcr } from "../src/services/ocrService.js";
import { validarDocumentosReplica } from "../src/services/replicaValidation.js";
import { aplicarHistoricoDoIp, describeIpDivergence } from "../src/utils/geoDivergence.js";
import { recomputeDerived } from "../src/services/analysisRecompute.js";
import { parseActDateToIso } from "../src/services/ipHistoryService.js";

/**
 * Integração do motor pericial v2 ao SaaS: pontos em que a mescla entre o motor
 * de geração e as correções anteriores do SaaS precisou de decisão própria.
 */

describe("endereço em tabela de colunas (texto com -layout)", () => {
  const TABELA =
    "  Bairro                                    Cidade                                   Estado                                    CEP\n" +
    "  CENTRO                                    Manaquiri                                AM                                        69435-000\n";

  it("casa cada valor com o rótulo pela posição da coluna", () => {
    expect(enderecoPorColunas(TABELA)).toEqual({
      bairro: "CENTRO",
      cidade: "Manaquiri",
      estado: "AM",
      cep: "69435-000",
    });
  });

  it("não aceita rótulo como cidade do contratante", () => {
    // Defeito real do dossiê C6: o padrão por rótulo lia "Estado" como cidade.
    const r = heuristicExtractionFromText(`Contrato de empréstimo consignado\n${TABELA}`);
    expect(r.cliente.cidade).toBe("Manaquiri");
    expect(valorEhRotulo(r.cliente.cidade)).toBe(false);
  });

  it("ignora linha de valores que também é rótulo", () => {
    expect(enderecoPorColunas("Bairro   Cidade   Estado\nCidade   Estado   CEP\n")).toBeNull();
  });
});

describe("endereço do contratante", () => {
  it("descarta o endereço da estipulante do seguro", () => {
    // Dossiê C6 real: a sede do banco em São Paulo saía como residência de uma
    // contratante do interior do Amazonas.
    const texto =
      "Endereço Completo: Nao Informado , SD - Manaquiri - AM " +
      "Estipulante: Banco C6 Consignado CNPJ: 61.348.538/0001-86 Endereço: AV Nove de Julho 3148 - Jardim Paulista - São Paulo – SP CEP: 01406-000.";
    const r = heuristicExtractionFromText(texto);
    expect(r.cliente.endereco ?? "").not.toMatch(/Nove de Julho/i);
  });

  it("reconhece contexto institucional e endereço não informado", () => {
    expect(enderecoInstitucional("Seguradora XYZ CNPJ 00.000.000/0001-00 Endereço: Rua A, 10", "Rua A, 10")).toBe(true);
    expect(enderecoInstitucional("Nome do cliente: Fulano Endereço: Rua A, 10", "Rua A, 10")).toBe(false);
    expect(enderecoNaoInformado("Completo: Nao Informado , SD - Manaquiri - AM")).toBe(true);
  });
});

describe("extração de IPs mesclada", () => {
  it("classifica a faixa de todo endereço encontrado", () => {
    const ips = extrairIps("Endereço IP: 177.104.55.201 às 10:00");
    expect(ips[0]).toMatchObject({ endereco: "177.104.55.201", classe: "PUBLICO", ordem: 1 });
  });

  it("inclui o IPv4 mapeado em IPv6 que só o motor encontra", () => {
    const ips = extrairIps("Sessão registrada a partir de ::ffff:189.40.112.87 no aplicativo do banco");
    expect(ips.map((i) => i.endereco)).toContain("::ffff:189.40.112.87");
  });

  it("não reintroduz número de versão como IP público", () => {
    const ips = extrairIps("Versão do aplicativo 2.14.0.1 instalada no aparelho");
    expect(ips.map((i) => i.endereco)).not.toContain("2.14.0.1");
  });
});

describe("salvaguardas de nome", () => {
  it("recusa rótulo de formulário e nome de terceiro", () => {
    expect(nomePlausivel("Do Cliente")).toBe(false);
    expect(nomePlausivel("Da Mae Lucia Franca")).toBe(false);
    expect(nomePlausivel("Maria Aparecida Souza")).toBe(true);
  });
});

describe("OCR: faixas de páginas", () => {
  it("lê o documento inteiro quando cabe no limite", () => {
    expect(faixasDeOcr(12, 20)).toEqual([[1, 12]]);
  });

  it("divide início e fim quando o documento excede o limite", () => {
    // O fim é onde ficam a trilha de auditoria e o termo de aceite.
    expect(faixasDeOcr(100, 20)).toEqual([[1, 12], [93, 100]]);
  });
});

describe("analisarDocumento (PDF real, sem rede)", () => {
  // Uma linha curta por página: o `pdftotext -layout` descarta texto que passa
  // da largura da página, e o PDF de teste não quebra linha.
  const pdf = makeSearchablePdf([
    "CEDULA DE CREDITO BANCARIO (CCB) N 1234567890",
    "EMPRESTIMO CONSIGNADO contrato beneficio banco valor",
    "Nome do cliente: Maria Aparecida Souza CPF: 111.444.777-35",
    "Valor da Operacao R$ 5.000,00 CET a.m. 2,10%",
    "Assinado eletronicamente por MARIA APARECIDA SOUZA",
    "Endereco IP: 177.104.55.201 Data e hora: 25/06/2025 10:45:03",
    "Latitude: -5.228841 Longitude: -43.11205 trilha de auditoria",
  ]);

  it("produz extração, metadados periciais e achados estruturados", async () => {
    const [extraction, rawMetadata] = await Promise.all([extractPdfTextWithOcr(pdf), extractPdfMetadata(pdf)]);
    const r = await analisarDocumento({ pdfBuffer: pdf, extraction, rawMetadata });

    expect(r.recusado).toBe(false);
    expect(r.extracted.contrato.numero).toBe("1234567890");
    expect(r.extracted.cliente.nome).toBe("Maria Aparecida Souza");
    expect(r.extracted.ips[0].endereco).toBe("177.104.55.201");
    expect(r.extracted.geolocalizacao_assinatura.latitude).toBe("-5.228841");
    expect(r.extracted.assinatura.assinatura_criptografica.estado).toBe("AUSENTE");
    expect(r.metadata.digitalSignature.catalog.acroform).toBe("AUSENTE");
    expect(Array.isArray(r.extracted.achados_irregularidade)).toBe(true);
    // Toda evidência textual corresponde a um achado estruturado.
    expect(r.extracted.evidencias_irregularidade).toHaveLength(r.extracted.achados_irregularidade.length);
    expect(r.eligibility.allowed).toBe(true);
  });

  it("recusa peça judicial quando exigido documento nativo", async () => {
    const peca = makeSearchablePdf(["EXCELENTISSIMO SENHOR DOUTOR JUIZ DE DIREITO contestação do banco réu"]);
    const [extraction, rawMetadata] = await Promise.all([extractPdfTextWithOcr(peca), extractPdfMetadata(peca)]);
    const r = await analisarDocumento({ pdfBuffer: peca, extraction, rawMetadata, enforceNativeDocument: true });
    expect(r.recusado).toBe(true);
    expect(r.eligibility.exclusions.map((e) => e.code)).toContain("JUDICIAL_ADDRESSING");
  });
});

describe("validação dos autos da réplica", () => {
  const b64 = (buffer) => Buffer.from(buffer).toString("base64");

  it("aceita PDF e TXT e calcula o SHA-256 de cada arquivo", () => {
    const r = validarDocumentosReplica([
      { name: "inicial.pdf", base64: b64(makeSearchablePdf(["Petição inicial"])) },
      { name: "contestacao.txt", base64: b64("Contestação") },
    ]);
    expect(r.ok).toBe(true);
    expect(r.arquivos.map((a) => a.sha256)).toEqual(r.arquivos.map(() => expect.stringMatching(/^[A-F0-9]{64}$/)));
  });

  it("recusa extensão proibida e conteúdo que não bate com a extensão", () => {
    const r = validarDocumentosReplica([
      { name: "virus.exe", base64: b64("MZ") },
      { name: "falso.pdf", base64: b64("não sou pdf") },
    ]);
    expect(r.ok).toBe(false);
    expect(r.detalhes).toHaveLength(2);
  });

  it("recusa lote vazio", () => {
    expect(validarDocumentosReplica([]).ok).toBe(false);
  });
});

describe("histórico do IP na data do ato", () => {
  it("interpreta a data do ato em formato brasileiro", () => {
    expect(parseActDateToIso("25/06/2025 10:45:03")).toBe("2025-06-25T10:45:03");
    expect(parseActDateToIso("25/06/2025")).toBe("2025-06-25T00:00:00");
  });

  it("suprime o veredito de distância quando o bloco mudou de detentor após o ato", () => {
    const divergencia = describeIpDivergence({ km: 9000, referenciaConfirmada: true });
    const historico = { suppressDistanceRisk: true, label: "REGISTRO ALTERADO APÓS O ATO", note: "Era operadora brasileira." };
    const r = aplicarHistoricoDoIp(divergencia, historico);
    expect(r.rotulo).toBe("REGISTRO ALTERADO APÓS O ATO");
    expect(r.nivel).toBe("suprimido");
    expect(r.km).toBe(9000);
  });

  it("recálculo mantém a supressão e remonta o sumário executivo", () => {
    const extraido = { cliente: { nome: "Fulano" }, assinatura: { presente: true }, ips: [{ endereco: "191.45.47.229" }] };
    const r = recomputeDerived(
      {
        text: JSON.stringify(extraido),
        home: { source: "manual", geo: { lat: -5.09, lon: -42.8, precision: "manual" } },
        ipAnalysis: [
          { endereco: "191.45.47.229", geo: { lat: 52.2, lon: 21.0 }, historico: { suppressDistanceRisk: true, label: "REGISTRO ALTERADO APÓS O ATO" } },
        ],
      },
      extraido
    );
    expect(r.ipAnalysis[0].divergenciaResidencia.nivel).toBe("suprimido");
    expect(r.sumarioIrregularidades).toBeTruthy();
    expect(r.sumarioIrregularidades.suspicionGrade.label).toBeTruthy();
  });
});

describe("catálogo de assinaturas do PDF", async () => {
  const { inspectCatalogSignatures } = await import("../src/engine/pdfForensics.js");

  /** PDF mínimo com AcroForm e um campo de assinatura, em ordem configurável. */
  function pdfAssinado({ catalogoPrimeiro, comTrailer = false }) {
    const objs = {
      catalog: "<< /Type /Catalog /Pages 3 0 R /AcroForm 5 0 R >>",
      info: "<< /Producer (Teste) >>",
      pages: "<< /Type /Pages /Count 0 /Kids [] >>",
      acro: "<< /Fields [6 0 R] /SigFlags 3 >>",
      field: "<< /FT /Sig /T (Assinatura1) /Rect [0 0 0 0] /V 7 0 R >>",
      sig: "<< /Type /Sig /SubFilter /adbe.pkcs7.detached /M (D:20250625104503-03'00') /ByteRange [0 10 20 30] >>",
    };
    const ordem = catalogoPrimeiro
      ? [[1, "catalog"], [2, "info"], [3, "pages"], [5, "acro"], [6, "field"], [7, "sig"]]
      : [[2, "info"], [3, "pages"], [5, "acro"], [6, "field"], [7, "sig"], [1, "catalog"]];
    let body = "%PDF-1.7\n";
    for (const [n, k] of ordem) body += `${n} 0 obj\n${objs[k]}\nendobj\n`;
    if (comTrailer) body += "trailer\n<< /Size 8 /Root 1 0 R /Info 2 0 R >>\n";
    return Buffer.from(`${body}%%EOF\n`);
  }

  it("encontra o AcroForm com o catálogo no início do arquivo", () => {
    const r = inspectCatalogSignatures(pdfAssinado({ catalogoPrimeiro: true }));
    expect(r.acroform).toBe("PRESENTE");
    expect(r.fields).toHaveLength(1);
  });

  it("encontra o AcroForm com o catálogo depois de outros objetos", () => {
    // Defeito herdado do motor de geração: aqui o laudo dizia AcroForm AUSENTE.
    const r = inspectCatalogSignatures(pdfAssinado({ catalogoPrimeiro: false }));
    expect(r.acroform).toBe("PRESENTE");
    expect(r.fields[0]).toMatchObject({ nome: "Assinatura1", assinado: true, invisivel: true });
    expect(r.signaturesExist).toBe(true);
  });

  it("prefere o /Root do trailer", () => {
    const r = inspectCatalogSignatures(pdfAssinado({ catalogoPrimeiro: false, comTrailer: true }));
    expect(r.acroformXref).toBe(5);
  });
});

describe("capturas soltas corrigidas (dossiê C6)", () => {
  const texto = [
    "Banco C6 Consignado S.A. - CNPJ 61.348.538/0001-86",
    "5.3. LIBERAÇÃO DO CRÉDITO: Crédito em Conta Banco: 237 - Ag: 3717 - Conta: 008621-5",
    "(i) Instituição Credora (ii) Credor Original",
    "(iii) Saldo Devedor (estimado)",
    "os dados de qualquer espécie apresentados por meio da Plataforma são de propriedade do C6",
    "Contrato de empréstimo consignado",
  ].join("\n");
  const r = heuristicExtractionFromText(texto);

  it("não usa o código do banco da conta de crédito como código do credor", () => {
    expect(r.contrato.codigo_banco_bacen).not.toBe("237");
    expect(r.contrato.banco_recebimento).toBe("Banco Bradesco S.A.");
    expect(r.contrato.agencia).toBe("3717");
    expect(r.contrato.conta_corrente).toBe("008621-5");
  });

  it("descarta marcador de lista como credor e cláusula como espécie", () => {
    expect(r.contrato.credor_original ?? null).toBeNull();
    expect(r.cliente.especie_beneficio ?? null).toBeNull();
  });
});
