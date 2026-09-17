import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { heuristicExtractionFromText } from "../src/services/extractionService.js";
import { redigirConclusaoAfericao } from "../src/engine/conclusaoAfericao.js";
import { extrairCamposOperacao, lerFinalidadeMarcada } from "../src/engine/camposOperacao.js";
import { generateJudicialQuesitos } from "../src/reports/quesitosTemplate.js";
import { descreverEstadoConfronto } from "../src/utils/referenciaResidencial.js";
import { buildImageFindings } from "../src/engine/pdfForensics.js";

/**
 * Ajustes de média prioridade da rodada 2 (relatorio-V2-MOTOR_NOVO.md):
 * MED-01, MED-03, MED-04, MED-05 e MED-06. MED-02 e MED-07 foram descartados.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));
const extraido = heuristicExtractionFromText(texto);

describe("MED-04: campos da operação no layout de caixas do C6", () => {
  it("dossiê: livre utilização, operação não portada, desconto em folha", () => {
    const c = extraido.contrato;
    expect(c.tipo_operacao).toBe("Livre utilização");
    expect(c.tipo_operacao_desmarcadas).toEqual(expect.arrayContaining(["Portabilidade de crédito", "Refinanciamento de dívida"]));
    expect(c.operacao_portada).toBe(false);
    expect(c.modalidade_desconto_provavel).toBe("Folha de pagamento, por consignação");
  });

  it("portabilidade marcada com saldo portado é operação portada", () => {
    const t = [
      "5.5. FINALIDADE DO CRÉDITO: [ ] Livre Utilização [ X ] Portabilidade de Crédito",
      "(i) Contrato / Operação Original 998877",
      "(ii) Credor Original Banco Exemplo",
      "(iii) Saldo Devedor (estimado) R$ 3.000,00",
    ].join("\n");
    expect(lerFinalidadeMarcada(t)).toMatchObject({ rotulo: "Portabilidade de crédito", desmarcadas: ["Livre utilização"] });
    expect(extrairCamposOperacao(t, { saldoPortado: "R$ 3.000,00" }).operacao_portada).toBe(true);
  });

  it("sem quadro nem caixa marcada, nada é afirmado", () => {
    const r = extrairCamposOperacao("Contrato de empréstimo sem quadro de finalidade.", { produtoCodigo: "INDETERMINADO" });
    expect(r).toMatchObject({ tipo_operacao: null, operacao_portada: null, modalidade_desconto_provavel: null });
  });

  it("duas caixas marcadas não viram tipo de operação", () => {
    expect(lerFinalidadeMarcada("FINALIDADE DO CRÉDITO: [ X ] Livre Utilização [ X ] Portabilidade de Crédito")).toBeNull();
  });
});

describe("MED-06: conclusão do § 2.1 gerada do resultado", () => {
  const todos = { prazo_confere: true, somatorio_confere: true, composicao_confere: true, vp_confere: true, cet_implicito_veredito: "Confere", cet_anual_confere: true, cet_maior_que_juros: true };

  it("dossiê: confere em tudo, exceto o prazo, que é nomeado", () => {
    const conclusao = extraido.afericao_matematica.conclusao;
    expect(conclusao).toMatch(/^A aferição financeira confere em todos os pontos aferidos, exceto no prazo total declarado: declarado 6 meses, efetivo 249 dias/);
    expect(conclusao).not.toMatch(/exigem conferência manual/);
  });

  it("todos conferem: texto de consistência", () => {
    expect(redigirConclusaoAfericao(todos)).toMatch(/^Não se identificou inconsistência aritmética/);
  });

  it("vários itens divergentes são nomeados, com o que confere e o que não foi aferido", () => {
    const texto = redigirConclusaoAfericao({ ...todos, somatorio_confere: false, somatorio_calculado: "R$ 10,00", somatorio_declarado: "R$ 12,00", composicao_confere: false, cet_anual_confere: null });
    expect(texto).toMatch(/diverge em 2 itens: somatório das parcelas \(calculado R\$ 10,00, declarado R\$ 12,00\) e composição do valor financiado/);
    expect(texto).toMatch(/Conferem: prazo total declarado/);
    expect(texto).toMatch(/Não foram aferidos: anualização do CET/);
  });

  it("nada aferido não afirma consistência", () => {
    expect(redigirConclusaoAfericao({})).toMatch(/^A aferição matemática não pôde ser realizada/);
  });
});

describe("MED-05: quesitos derivados dos achados", () => {
  const extracted = {
    ...extraido,
    imagem_biometrica: { pagina: 14, largura: 480, altura: 640, megapixels: 0.31, exif: false, contagem_faciais: 1, dados_do_processo_ausentes: ["fornecedor da biometria"] },
  };
  const achados = [...extraido.achados_irregularidade, { codigo: "BIO2", gravidade: "ALTA", titulo: "Lastro biométrico frágil", texto: "x" }];
  const quesitos = generateJudicialQuesitos({ banco: "Banco C6 Consignado", clienteNome: "a contratante", achados, extracted });
  const titulos = quesitos.map((q) => q.titulo);
  const todoTexto = quesitos.map((q) => `${q.titulo} ${q.quesito} ${q.finalidade}`).join(" ");

  it("negativo 8: pelo menos oito quesitos, cobrindo os achados do relatório", () => {
    expect(quesitos.length).toBeGreaterThanOrEqual(8);
    expect(titulos).toEqual(expect.arrayContaining([
      "Comprovação do Crédito Liberado",
      "Identificação do Empregador e da Averbação",
      "Cadastro do Contratante",
      "Seguro Prestamista Vinculado à Operação",
      "Tempo de Exibição do Instrumento na Jornada",
    ]));
    expect(quesitos.map((q) => q.numero)).toEqual(quesitos.map((_, i) => i + 1));
  });

  it("os quesitos citam os valores do instrumento", () => {
    expect(todoTexto).toMatch(/R\$ 1\.779,15 na conta 005555-1, agência 1234, Banco 237/);
    expect(todoTexto).toMatch(/"000007 - CONSIG TRAB"/);
    expect(todoTexto).toMatch(/111111111111/);
    expect(todoTexto).toMatch(/carência de 90 dias e franquia de 31 dias tornam a indenização possível apenas 121 dias/);
    expect(todoTexto).toMatch(/pró-labore de R\$ 98,02/);
    expect(todoTexto).toMatch(/27 segundos após o evento anterior para 12 páginas/);
    expect(todoTexto).not.toMatch(/undefined|null|NaN|operação ,/);
  });

  it("INT1 e BIO2 substituem os quesitos gerais do mesmo tema, sem duplicar", () => {
    expect(titulos.filter((t) => /Integridade Criptográfica/.test(t))).toHaveLength(1);
    expect(titulos.filter((t) => /Validação Biométrica/.test(t))).toHaveLength(1);
    expect(todoTexto).toMatch(/0,31 megapixel/);
    expect(todoTexto).toMatch(/protocolo interno/);
  });

  it("sem achados, só os quesitos gerais", () => {
    const gerais = generateJudicialQuesitos({ banco: "Banco X" });
    expect(gerais.map((q) => q.titulo)).toHaveLength(4);
  });

  it("achado MÉDIA sem modelo nominal não gera quesito", () => {
    const q = generateJudicialQuesitos({ banco: "Banco X", achados: [{ codigo: "SEG3", gravidade: "MÉDIA" }, { codigo: "TRL2", gravidade: "MÉDIA" }], extracted: {} });
    expect(q).toHaveLength(4);
  });

  it("achado com dado ausente não imprime lacuna", () => {
    const q = generateJudicialQuesitos({ banco: "Banco X", achados: [{ codigo: "LIB1", gravidade: "ALTA" }, { codigo: "CAD4", gravidade: "MÉDIA" }, { codigo: "SEG1", gravidade: "ALTA" }], extracted: {} });
    const t = q.map((x) => x.quesito).join(" ");
    expect(t).not.toMatch(/undefined|null|NaN/);
    expect(q.map((x) => x.titulo)).not.toContain("Seguro Prestamista Vinculado à Operação");
  });
});

describe("MED-01: um único motivo de recusa", () => {
  it("recusa com endereço não informado no instrumento orienta pela lacuna da instituição", () => {
    const texto = descreverEstadoConfronto({
      estado_confronto: "RECUSADO_CONFLITO",
      conflito: { descricao: "conflito entre endereço informado (PI) e endereço extraído do instrumento (AM)", manual: { texto: "Rua X, Pedro II - PI" } },
      instrumento: { cidade: "Manaquiri", uf: "AM", cep: "69435-000" },
      endereco_nao_informado: true,
      endereco_literal: "Nao Informado, SD",
    });
    expect(texto).toMatch(/^CONFRONTO RECUSADO/);
    expect(texto).toMatch(/não pode ser feito a partir deste arquivo; essa lacuna é atribuível à instituição/);
    expect(texto).not.toMatch(/tente novamente|grafia/i);
  });

  it("recusa com endereço presente no instrumento não fala em lacuna", () => {
    const texto = descreverEstadoConfronto({ estado_confronto: "RECUSADO_CONFLITO", conflito: { descricao: "conflito de UF" }, instrumento: { uf: "AM" } });
    expect(texto).not.toMatch(/lacuna/);
  });
});

describe("MED-03: IMG2 de template fora do corpo", () => {
  const imagens = [{ page: 1, classificacao: "logotipo/template", biometricaProvavel: false, width: 200, height: 60, size: "20K" }];
  const grupoTemplate = { sha256: "a", ocorrencias: 10, imagens: [{ classificacao: "logotipo/template" }, { classificacao: "máscara alfa" }] };

  it("grupos só de template, logotipo ou máscara não geram IMG2", () => {
    const achados = buildImageFindings(imagens, [grupoTemplate, grupoTemplate], 1, true, {});
    expect(achados.map((a) => a.codigo)).not.toContain("IMG2");
  });

  it("grupo repetido de imagem documental continua informado", () => {
    const achados = buildImageFindings(imagens, [grupoTemplate, { sha256: "b", imagens: [{ classificacao: "imagem documental" }] }], 1, true, {});
    expect(achados.find((a) => a.codigo === "IMG2")).toMatchObject({ severidade: "INFO", titulo: "Reuso de imagem documental" });
  });

  it("grupo repetido com biometria provável continua crítico", () => {
    const achados = buildImageFindings(imagens, [{ sha256: "c", imagens: [{ classificacao: "fotografia/biometria provável", biometricaProvavel: true }] }], 1, true, {});
    expect(achados.find((a) => a.codigo === "IMG2")).toMatchObject({ severidade: "CRÍTICO" });
  });
});
