import { describe, it, expect } from "vitest";
import { extrairLocalEmissao } from "../../src/engine/camposOperacao.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";
import { segmentarDocumentos, avaliarAssinaturaPorDocumento } from "../../src/engine/documentosLogicos.js";
import { titleCaseName } from "../../src/engine/format.js";
import { titleCaseName as titleCaseNameUtils } from "../../src/utils/stringUtils.js";
import { fundamentacaoPara } from "../../src/reports/laudoTexts.js";
import { descreverEstadoConfronto, ESTADO_CONFRONTO } from "../../src/utils/referenciaResidencial.js";
import { classificarGrauProcessual, GRAUS } from "../../src/engine/grausConclusao.js";
import { buildIrregularitySummary } from "../../src/engine/irregularitySummary.js";

// Modelo da CCB de saque do cartão consignado Credcesta (Banco Master), com
// dados fictícios. Reproduz o que o laudo de 25/09/2026 leu errado: via,
// telefone, local do ato, identificador da sessão e "nome da agência".
const PAGINA_1 = `CÉDULA DE CRÉDITO BANCÁRIO ("CCB") CONTRATAÇÃO DE SAQUE MEDIANTE TRANSFERÊNCIA
DE RECURSOS DO CARTÃO CONSIGNADO DE BENEFÍCIO CREDCESTA EMITIDO PELO BANCO MASTER S.A.
CCB nº: 11223344
Tipo de Operação: X  Saque Fácil  Saque Complementar  Saque Refinanciamento
 FORÇAS ARMADAS  SERVIDOR PÚBLICO  INSS X  OUTROS
QUADRO 1 - CREDOR
BANCO MASTER S.A., com sede na cidade do Rio de Janeiro, Estado do Rio de Janeiro, na Praia de
Botafogo, n.º 228, 17º andar, sala 1.702, Botafogo, CEP: 22250-906, inscrito no CNPJ/ME sob o n.º
33.923.798/0001-00 por meio de sua filial situada na Capital do Estado de São Paulo, na Avenida
Brigadeiro Faria Lima, n.º 3.477, 5º andar, Torre B, Itaim Bibi, CEP 04538-133 ("BANCO MASTER").
QUADRO 2 - DADOS PESSOAIS DO(A) CLIENTE (EMITENTE/ADERENTE)
Nome do Cliente:
MARIA DA SILVA TESTE
CPF:
123.456.789-09
Endereço Residencial:
Rua das Flores
Nº
20
Complemento:
Bairro:
Jardim Juliana
Cidade:
Amparo
Estado:
SP
CEP:
13905-390
Telefone/Celular:
(19) 99999-0001
E-mail:
MARIA@EXEMPLO.COM
QUADRO 3 - DADOS FUNCIONAIS
Fonte Pagadora:
CREDCESTA GOV SP SECRETARIA
Matrícula/Nº Benefício:
7000001
Assinatura digital: 0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab
Página 1 de 3. Versão: 10 - 05.2023 VIA DO BANCO NEGOCIÁVEL / X VIA DO EMITENTE NÃO NEGOCIÁVEL`;

const PAGINA_2 = `4.7. Tarifa de Cadastro: 4.8. Seguro Prestamista:
R$ R$
QUADRO 9 - AUTORIZAÇÃO DE DÉBITO EM CONTA CORRENTE
Banco: SANTANDER Nº Banco: 033 Agência: 0029 Conta Corrente: 01005148
1. Emito esta CCB em favor do BANCO MASTER.
Assinatura digital: 0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab
Página 2 de 3. Versão: 10 - 05.2023 VIA DO BANCO NEGOCIÁVEL / X VIA DO EMITENTE NÃO NEGOCIÁVEL`;

const PAGINA_3 = `DOCUMENTO ASSINADO ELETRONICAMENTE
Local: Amparo - SP
Foto usuário
 Geolocalização
-22.7295123, -46.8973104
Data e hora
13/09/2023 10:37
Nome do Cliente
MARIA DA SILVA TESTE
CPF
123.456.789-09
ID da sessão usuário
0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab
Central de Relacionamento: 4003-3920 (Grande Salvador) e 0800 729 0660 (Demais Regiões)
Assinatura digital: 0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab
Página 3 de 3. Versão: 10 - 05.2023 VIA DO BANCO NEGOCIÁVEL / X VIA DO EMITENTE NÃO NEGOCIÁVEL`;

const TEXTO = [PAGINA_1, PAGINA_2, PAGINA_3].join("\f");

describe("CCB Credcesta do Banco Master: campos que o laudo de 25/09 leu errado", () => {
  const e = heuristicExtractionFromText(TEXTO);

  it("a via declarada é a marcada com X, não a primeira impressa", () => {
    expect(e.contrato.via_declarada).toBe("VIA DO EMITENTE NÃO NEGOCIÁVEL");
  });

  it("o local do ato declarado no bloco de assinatura vira município de emissão", () => {
    expect(e.contrato.local_emissao).toMatchObject({ municipio: "Amparo", uf: "SP" });
    expect(extrairLocalEmissao("Local de pagamento: Amparo - SP")).toBeNull();
    expect(extrairLocalEmissao("DOCUMENTO ASSINADO ELETRONICAMENTE\nLocal: São José do Rio Preto - SP\nFoto")).toMatchObject({ municipio: "São José do Rio Preto", uf: "SP" });
  });

  it("o telefone sai com o parêntese do DDD", () => {
    expect(e.cliente.telefone).toBe("(19) 99999-0001");
  });

  it("o identificador da sessão é registrado como código de autenticação declarado", () => {
    expect(e.assinatura.codigo_autenticacao_declarado).toBe("0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab");
    expect(e.assinatura.codigo_autenticacao_origem).toMatch(/ID da sessão usuário/);
    expect(e.assinatura.codigo_autenticacao_origem).toMatch(/pág\. 3/);
  });

  it("não acusa 'nome da agência em branco' num formulário que não tem esse campo", () => {
    expect(e.achados_irregularidade.map((a) => a.codigo)).not.toContain("CAD1");
    expect(e.contrato.agencia).toBe("0029");
  });

  it("o produto é consignado de servidor e a cidade é a do cliente, não a do credor", () => {
    expect(e.contrato.produto_codigo).toBe("CONSIGNADO_SERVIDOR");
    expect(e.cliente.cidade).toBe("Amparo");
    expect(e.cliente.bairro).toBe("Jardim Juliana");
  });
});

describe("segmentação da CCB Credcesta", () => {
  it("a menção a 'Seguro Prestamista' num campo do quadro não abre documento de seguro", () => {
    const seg = segmentarDocumentos(TEXTO);
    expect(seg.documentos).toHaveLength(1);
    expect(seg.documentos[0]).toMatchObject({ tipo: "INSTRUMENTO_PRINCIPAL", paginaInicial: 1, paginaFinal: 3 });
  });

  it("o bloco 'DOCUMENTO ASSINADO ELETRONICAMENTE' com 'Nome do Cliente' é bloco de assinatura da cédula", () => {
    const seg = segmentarDocumentos(TEXTO);
    expect(seg.documentos[0].blocosAssinatura).toHaveLength(1);
    expect(seg.documentos[0].blocosAssinatura[0]).toMatchObject({ pagina: 3, titular: "MARIA DA SILVA TESTE" });
    const avaliacao = avaliarAssinaturaPorDocumento(seg);
    expect(avaliacao.achado).toBeNull();
    expect(avaliacao.resumo).toMatch(/bloco de assinatura na pág\. 3/);
    expect(avaliacao.totalBlocos).toBe(1);
  });

  it("título de proposta de seguro no início da página continua abrindo documento de seguro", () => {
    const seg = segmentarDocumentos("CÉDULA DE CRÉDITO BANCÁRIO\ncláusulas\fPROPOSTA DE ADESÃO AO SEGURO PRESTAMISTA\ncondições");
    expect(seg.documentos.map((d) => d.tipo)).toEqual(["INSTRUMENTO_PRINCIPAL", "SEGURO"]);
  });
});

describe("caixa alta e baixa em nomes e cidades com acento", () => {
  it("não deixa 'SÃO Paulo' nem 'JosÉ'", () => {
    expect(titleCaseName("SÃO PAULO")).toBe("São Paulo");
    expect(titleCaseName("RIBEIRÃO PRETO")).toBe("Ribeirão Preto");
    expect(titleCaseName("JOSÉ ÁLVARO DE ASSUNÇÃO")).toBe("José Álvaro De Assunção");
    expect(titleCaseNameUtils("SÃO PAULO")).toBe("São Paulo");
    expect(titleCaseName("Amparo")).toBe("Amparo");
  });
});

describe("fundamentação por produto", () => {
  it("consignado de servidor não recebe o bloco do INSS nem a Lei 8.213", () => {
    const grupos = fundamentacaoPara("CONSIGNADO_SERVIDOR");
    const nomes = grupos.map((g) => g.grupo);
    expect(nomes).toContain("Crédito consignado de servidor público");
    expect(nomes).not.toContain("Crédito consignado e benefício do INSS");
    const dispositivos = grupos.flatMap((g) => g.itens.map(([d]) => d)).join(" | ");
    expect(dispositivos).not.toMatch(/8\.213/);
    expect(dispositivos).not.toMatch(/Normas do INSS/);
    expect(dispositivos).toMatch(/Lei 8\.112\/1990, art\. 45/);
  });
  it("consignado INSS continua com o bloco do INSS", () => {
    expect(fundamentacaoPara("CONSIGNADO_INSS").map((g) => g.grupo)).toContain("Crédito consignado e benefício do INSS");
  });
});

describe("textos do § 5 e do sumário", () => {
  it("a divergência cadastral sai em frases inteiras", () => {
    const texto = descreverEstadoConfronto({
      estado_confronto: ESTADO_CONFRONTO.DIVERGENCIA_CADASTRAL,
      distancia_divergencia_cadastral: 4.7,
      conflito: { descricao: "CEP informado (13906881) diferente do CEP extraído do instrumento (13905390); confira qual referência deve ser usada", manual: { texto: "Rua A, 50, Amparo/SP" } },
      instrumento: { cidade: "Amparo", uf: "SP", cep: "13905-390" },
    });
    expect(texto).toMatch(/deve ser usada\. Os dois endereços ficam a aproximadamente 4,7 km um do outro\. Endereço informado: Rua A/);
    expect(texto).not.toMatch(/\. distantes/);
  });
});

describe("coordenada do ato contra o local declarado no instrumento", () => {
  const base = () => ({
    reportId: "FD-TESTE-MASTER",
    file: { name: "ccb.pdf", sizeKB: "100.00" },
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    metadata: { totalPages: 3, title: "CCB", author: null, subject: null, creator: null, producer: "dompdf", hasEmbeddedSignatures: false, warnings: [] },
    extracted: {
      contrato: { numero: "11223344", banco: "BANCO MASTER S.A", data_contrato: "13/09/2023", produto_codigo: "CONSIGNADO_SERVIDOR" },
      cliente: { nome: "Maria da Silva Teste", cpf: "123.456.789-09", cidade: "Amparo", estado: "SP", cep: "13905-390" },
      assinatura: { presente: true, tipo: "Indeterminado", data_hora_assinatura: "13/09/2023 10:37", metodos_autenticacao: [] },
      cadeia_custodia: {},
      trilha_acesso: { eventCount: 0, uniqueIps: [], deviceIdentifiable: false },
      evidencias_irregularidade: [],
    },
    home: { geo: { lat: -22.7080593, lon: -46.7726654, matchedCity: "Amparo", matchedUf: "SP" }, query: "Amparo - SP", estado_confronto: "DISPONIVEL", local_emissao: { municipio: "Amparo", uf: "SP", literal: "Local: Amparo - SP" } },
    contractGeo: { lat: -22.7295123, lon: -46.8973104, municipio: "Pedreira", uf: "SP", distance: 13.0 },
    confronto_enderecos: { pares: [{ id: "gps-x-emissao", km: 9.8 }] },
    geoDeclaredPresent: true,
    ipAnalysis: [],
  });

  it("aponta o achado quando a coordenada cai fora do município declarado, com grau constatado", () => {
    const summary = buildIrregularitySummary(base());
    const achado = (summary.allFindings || summary.findings).find((f) => f.key === "gps-local-declarado");
    expect(achado).toBeTruthy();
    expect(achado.text).toMatch(/declara como local do ato Amparo\/SP/);
    expect(achado.text).toMatch(/cai em Pedreira\/SP, a 9,8 km da sede do município declarado/);
    expect(achado.text).not.toMatch(/assinatura/);
    expect(classificarGrauProcessual("gps-local-declarado")).toBe(GRAUS.CONSTATADO);
  });

  it("fica em silêncio quando a coordenada cai no município declarado", () => {
    const report = base();
    report.contractGeo = { ...report.contractGeo, municipio: "Amparo" };
    const summary = buildIrregularitySummary(report);
    expect((summary.allFindings || summary.findings).some((f) => f.key === "gps-local-declarado")).toBe(false);
  });
});
