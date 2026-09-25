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

// ─── Rodada 6: texto em colunas (pdftotext -layout), quadro em branco e correspondente ───
import { quadroClienteEmBranco } from "../../src/engine/salvaguardas.js";

const LAYOUT_2023 = `CÉDULA DE CRÉDITO BANCÁRIO ("CCB") CONTRATAÇÃO DE SAQUE MEDIANTE TRANSFERÊNCIA
DE RECURSOS DO CARTÃO CONSIGNADO DE BENEFÍCIO CREDCESTA EMITIDO PELO BANCO MASTER S.A.
CCB nº: 11223344
Tipo de Operação: X  Saque Fácil  Saque Complementar  Saque Refinanciamento
 FORÇAS ARMADAS  SERVIDOR PÚBLICO  INSS X  OUTROS
QUADRO 1 - CREDOR
BANCO MASTER S.A., com sede na cidade do Rio de Janeiro, Estado do Rio de Janeiro, na Praia de
Botafogo, n.º 228, 17º andar, sala 1.702, Botafogo, CEP: 22250-906, inscrito no CNPJ/ME sob o n.º
33.923.798/0001-00 por meio de sua filial situada na Capital do Estado de São Paulo, na Avenida
Brigadeiro Faria Lima, n.º 3.477, 5º andar, Torre B, Itaim Bibi, CEP 04538-133 ("CREDOR").
QUADRO 2 - DADOS PESSOAIS DO(A) CLIENTE (EMITENTE/ADERENTE)
Nome do Cliente:                                   CPF:
MARIA DA SILVA TESTE                               123.456.789-09
RG:                                                Data de Nascimento:
21202001                                           02/04/1962
Endereço Residencial:              Nº              Complemento:
Rua das Flores                     20
Bairro:              Cidade:           Estado:         CEP:
Jardim Juliana       Amparo            SP              13905-390
Telefone/Celular:                                  E-mail:
(19) 99999-0001                                    MARIA@EXEMPLO.COM
Nome do Representante Legal:                       CPF:
QUADRO 3 - DADOS FUNCIONAIS
Fonte Pagadora:                      Matrícula/Nº Benefício:
CREDCESTA GOV SP SECRETARIA          7000001
QUADRO 4 - CARACTERÍSTICA DA OPERAÇÃO DE SAQUE DO CARTÃO DE BENEFÍCIO CONSIGNADO CREDCESTA
4.1.1. Valor do Saque:               4.2.1. Saldo Devedor Atualizado e Consolidado:
R$ 12.000,00                         R$
QUADRO 9 - AUTORIZAÇÃO DE DÉBITO EM CONTA CORRENTE
Banco: SANTANDER Nº Banco: 033 Agência: 0029 Conta Corrente: 01005148
QUADRO 10 - CANAL DE VENDAS/CORRESPONDENTE NO PAÍS/SUBSTABELECIDO:
Empresa: 000483- CREDITO EXEMPLO                        CNPJ: 12.345.678/0001-90
Endereço: RUA DAS PALMEIRAS, 126 - ANEXO D - JARDIM MORUMBI -
PRESIDENTE PRUDENTE
Telefone: (18) 3344-0000
Agente Certificado: ANA MARIA EXEMPLO                    CPF: 11122233344
Condições Gerais da Cédula de Crédito Bancário ("CCB") aplicáveis ao Cartão Consignado de Benefício -
1. Por minha solicitação, o BANCO MASTER emite o cartão.
Assinatura digital: 0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab
Página 1 de 3. Versão: 10 - 05.2023 VIA DO BANCO NEGOCIÁVEL / X VIA DO EMITENTE NÃO NEGOCIÁVEL`;

const LAYOUT_2024_EM_BRANCO = LAYOUT_2023
  .replace("Jardim Juliana       Amparo            SP              13905-390\n", "")
  .replace("(19) 99999-0001                                    MARIA@EXEMPLO.COM\n", "")
  .replace("CREDCESTA GOV SP SECRETARIA          7000001\n", "Cargo/Função:                        Salário/Renda\n")
  .replace("Rua das Flores                     20\n", "");

describe("texto em colunas do pdftotext -layout: cliente, credor e correspondente em quadros separados", () => {
  const e = heuristicExtractionFromText(LAYOUT_2023);

  it("o telefone e o e-mail são os do quadro do cliente, não os do correspondente", () => {
    expect(e.cliente.telefone).toBe("(19) 99999-0001");
    expect(e.cliente.email).toBe("MARIA@EXEMPLO.COM");
  });

  it("o CEP é o do cliente, e o CEP do credor nunca entra na qualificação", () => {
    expect(e.cliente.cep).toBe("13905-390");
    expect(e.cliente.cidade).toBe("Amparo");
    expect(e.cliente.bairro).toBe("Jardim Juliana");
    expect(e.cliente.cpf).toBe("123.456.789-09");
  });

  it("o correspondente do Quadro 10 é lido por inteiro", () => {
    expect(e.correspondente).toMatchObject({
      nome: "CREDITO EXEMPLO",
      codigo: "000483",
      cnpj: "12.345.678/0001-90",
      telefone: "(18) 3344-0000",
      agente_nome: "ANA MARIA EXEMPLO",
      cidade: "PRESIDENTE PRUDENTE",
    });
    expect(e.correspondente.endereco).toMatch(/^RUA DAS PALMEIRAS, 126/);
    expect(e.contrato.correspondente).toMatchObject({ nome: "CREDITO EXEMPLO", codigo: "000483" });
    expect(e.achados_irregularidade.map((a) => a.codigo)).not.toContain("CAD5");
  });
});

describe("quadro de dados pessoais em branco (CCB Credcesta de 2024)", () => {
  it("o helper lista os campos com rótulo e sem valor", () => {
    expect(quadroClienteEmBranco(LAYOUT_2024_EM_BRANCO)).toEqual(["bairro", "cidade", "estado", "cep", "telefone", "fonte_pagadora"]);
    expect(quadroClienteEmBranco(LAYOUT_2023)).toEqual([]);
  });

  it("nenhum campo é preenchido com o endereço da filial do credor e o vazio vira achado constatado", () => {
    const e = heuristicExtractionFromText(LAYOUT_2024_EM_BRANCO);
    expect(e.cliente.cidade).toBeNull();
    expect(e.cliente.bairro).toBeNull();
    expect(e.cliente.cep).toBeNull();
    expect(e.cliente.telefone).toBeNull();
    expect(e.cliente.estados_campos.cidade).toMatchObject({ estado: "LOCALIZADO_VAZIO" });
    expect(e.cliente.estados_campos.telefone).toMatchObject({ estado: "LOCALIZADO_VAZIO" });
    const cad5 = e.achados_irregularidade.find((a) => a.codigo === "CAD5");
    expect(cad5).toBeTruthy();
    expect(cad5.texto).toMatch(/bairro, cidade, estado, CEP, telefone, fonte pagadora/);
    expect(cad5.texto).not.toMatch(/assinatura|código/);
    expect(classificarGrauProcessual("CAD5", "ALTA")).toBe(GRAUS.CONSTATADO);
  });
});

describe("texto corrido (pdftotext sem -layout): rótulos em linha própria", () => {
  const CORRIDO_EM_BRANCO = `QUADRO 2 - DADOS PESSOAIS DO(A) CLIENTE (EMITENTE/ADERENTE)
Nome do Cliente:
MARIA DA SILVA TESTE
CPF:
123.456.789-09
Endereço Residencial:
Nº
Complemento:
Bairro:
Cidade:
Estado:
CEP:
Telefone/Celular:
E-mail:
Nome do Representante Legal: CPF:
QUADRO 3 - DADOS FUNCIONAIS
Fonte Pagadora:
Matrícula/Nº Benefício:
Cargo/Função: Salário/Renda
R$:`;
  const CORRIDO_PREENCHIDO = CORRIDO_EM_BRANCO
    .replace("Bairro:\nCidade:\nEstado:\nCEP:\nTelefone/Celular:\nE-mail:\n", "Bairro:\nJardim Juliana\nCidade:\nAmparo\nEstado:\nSP\nCEP:\n13905-390\nTelefone/Celular:\n(19) 99999-0001\nE-mail:\nMARIA@EXEMPLO.COM\n")
    .replace("Fonte Pagadora:\nMatrícula/Nº Benefício:\n", "Fonte Pagadora:\nCREDCESTA GOV SP SECRETARIA\nMatrícula/Nº Benefício:\n7000001\n");

  it("rótulo seguido de rótulo é vazio; rótulo seguido de valor não", () => {
    expect(quadroClienteEmBranco(CORRIDO_EM_BRANCO)).toEqual(["bairro", "cidade", "estado", "cep", "telefone", "fonte_pagadora"]);
    expect(quadroClienteEmBranco(CORRIDO_PREENCHIDO)).toEqual([]);
  });
});

describe("condições gerais assinadas no fim são a assinatura da própria cédula", () => {
  it("não gera ASS1 quando o bloco está na última página das condições gerais", () => {
    const texto = [
      "CÉDULA DE CRÉDITO BANCÁRIO (\"CCB\") CONTRATAÇÃO DE SAQUE\nCCB nº: 11223344\nQUADRO 1 - CREDOR",
      "CONDIÇÕES GERAIS DA CÉDULA DE CRÉDITO BANCÁRIO\n1. Por minha solicitação.",
      "DOCUMENTO ASSINADO ELETRONICAMENTE\nLocal: Amparo - SP\nNome do Cliente\nMARIA DA SILVA TESTE\nCPF\n123.456.789-09",
    ].join("\f");
    const seg = segmentarDocumentos(texto);
    expect(seg.documentos.map((d) => d.tipo)).toEqual(["INSTRUMENTO_PRINCIPAL", "CONDICOES_GERAIS"]);
    const avaliacao = avaliarAssinaturaPorDocumento(seg);
    expect(avaliacao.achado).toBeNull();
    expect(avaliacao.resumo).toMatch(/Condições gerais \(págs\. 2 a 3\): bloco de assinatura na pág\. 3/);
  });

  it("continua acusando ASS1 quando só a proposta de seguro tem bloco", () => {
    const texto = [
      "CÉDULA DE CRÉDITO BANCÁRIO\nCCB nº: 1",
      "PROPOSTA DE ADESÃO AO SEGURO PRESTAMISTA\nAssinatura do Proponente",
    ].join("\f");
    const avaliacao = avaliarAssinaturaPorDocumento(segmentarDocumentos(texto));
    expect(avaliacao.achado?.codigo).toBe("ASS1");
  });
});

describe("CCB Credcesta de 2024: residência da contratante igual ao endereço do credor", () => {
  const LAYOUT_2024_REAL = LAYOUT_2023
    .replace("Rua das Flores                     20\n", "Avenida Brigadeiro Faria Lima      228\n")
    .replace("Jardim Juliana       Amparo            SP              13905-390\n", "Itaim Bibi           São Paulo         SP\n")
    .replace("(19) 99999-0001                                    MARIA@EXEMPLO.COM\n", "(37) 99999-0002                                    MARIA@EXEMPLO.COM\n");
  const e = heuristicExtractionFromText(LAYOUT_2024_REAL);

  it("bairro e cidade vêm do quadro do cliente, o CEP fica vazio e o CEP do credor não entra", () => {
    expect(e.cliente.bairro).toBe("Itaim Bibi");
    expect(e.cliente.cidade).toBe("São Paulo");
    expect(e.cliente.estado).toBe("SP");
    expect(e.cliente.cep).toBeNull();
    expect(e.cliente.telefone).toBe("(37) 99999-0002");
    expect(e.achados_irregularidade.map((a) => a.codigo)).not.toContain("CAD5");
  });

  it("aponta CAD6 constatado: logradouro e bairro do quadro do cliente são os do quadro do credor", () => {
    const cad6 = e.achados_irregularidade.find((a) => a.codigo === "CAD6");
    expect(cad6).toBeTruthy();
    expect(cad6.texto).toMatch(/Avenida Brigadeiro Faria Lima/);
    expect(cad6.texto).toMatch(/bairro Itaim Bibi/);
    expect(cad6.texto).toMatch(/São Paulo\/SP/);
    expect(classificarGrauProcessual("CAD6", "ALTA")).toBe(GRAUS.CONSTATADO);
    expect(e.cliente.endereco).toBe("Avenida Brigadeiro Faria Lima");
    expect(heuristicExtractionFromText(LAYOUT_2023).achados_irregularidade.map((a) => a.codigo)).not.toContain("CAD6");
  });

  it("DDD 37 (MG) num cadastro em SP vira TEL1; DDD 19 em SP não", () => {
    const tel1 = e.achados_irregularidade.find((a) => a.codigo === "TEL1");
    expect(tel1).toBeTruthy();
    expect(tel1.texto).toMatch(/DDD 37, atribuído pela Anatel a MG/);
    expect(heuristicExtractionFromText(LAYOUT_2023).achados_irregularidade.map((a) => a.codigo)).not.toContain("TEL1");
  });
});

describe("identificador da sessão no texto em colunas", () => {
  it("quando o rótulo da sessão e o valor ficam em linhas distintas, o rodapé 'Assinatura digital:' dá o código", () => {
    const texto = `${LAYOUT_2023}\fDOCUMENTO ASSINADO ELETRONICAMENTE
Local: Amparo - SP
CPF                                   ID da sessão usuário
123.456.789-09                        0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab
Assinatura digital: 0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab`;
    const e = heuristicExtractionFromText(texto);
    expect(e.assinatura.codigo_autenticacao_declarado).toBe("0f0f0f0f-aaaa-4bbb-8ccc-0123456789ab");
    expect(e.assinatura.codigo_autenticacao_origem).toMatch(/Assinatura digital|ID da sessão/);
  });
});

import { generateJudicialQuesitos } from "../../src/reports/quesitosTemplate.js";
describe("quesito do endereço cadastral igual ao do credor", () => {
  it("CAD6 gera quesito citando o logradouro e o bairro do credor", () => {
    const texto = LAYOUT_2023
      .replace("Rua das Flores                     20\n", "Avenida Brigadeiro Faria Lima      228\n")
      .replace("Jardim Juliana       Amparo            SP              13905-390\n", "Itaim Bibi           São Paulo         SP\n");
    const e = heuristicExtractionFromText(texto);
    const saida = generateJudicialQuesitos({ banco: "BANCO MASTER S.A", achados: e.achados_irregularidade, extracted: e });
    const lista = Array.isArray(saida) ? saida : (saida.quesitos || saida.itens || Object.values(saida).find(Array.isArray) || []);
    const q = lista.find((x) => /Origem do Endereço Cadastral/.test(x.titulo || ""));
    expect(q).toBeTruthy();
    expect(q.quesito).toMatch(/Avenida Brigadeiro Faria Lima/);
    expect(q.quesito).toMatch(/bairro Itaim Bibi/);
    expect(q.quesito).toMatch(/BANCO MASTER S\.A/);
  });
});
