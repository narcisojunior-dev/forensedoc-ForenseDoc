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
import { montarConfrontoEnderecos, descreverIndisponibilidade } from "../src/utils/confrontoEnderecos.js";

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

  /**
   * D4 mudou o desfecho deste item: o campo de prazo do dossiê é condicional
   * ("6 meses ou até o pagamento da última parcela"), então o prazo deixa de
   * DIVERGIR e passa a NÃO SER AFERIDO, com o motivo nomeado. O que MED-06
   * prendia continua valendo: a conclusão nomeia o que confere e o que não foi
   * aferido, em vez da frase genérica de conferência manual.
   */
  it("dossiê: confere em tudo, e o prazo sai como não aferido, com o motivo", () => {
    const conclusao = extraido.afericao_matematica.conclusao;
    expect(conclusao).toMatch(/^A aferição matemática confere em todos os itens aferidos/);
    expect(conclusao).toMatch(/Não foram aferidos: prazo total declarado \(o campo declara o prazo de forma condicional/);
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

describe("ajustes finos da rodada 2", () => {
  const m = extraido.afericao_matematica;

  it("FINO-01 (D4): valor presente pela taxa declarada mantido, com a taxa implícita sobre o financiado ao lado", () => {
    expect(m.vp_taxa_declarada).toBe("R$ 2.034,08");
    expect(m.vp_confere).toBe(true);
    expect(m.juros_implicito_mensal).toBe("5,0620%");
    expect(m.juros_implicito_confere).toBe(true);
    expect(m.vp_taxa_implicita).toBe("R$ 2.033,86");
  });

  it("FINO-02: anualização pelo CET implícito fecha com os 143,52% do contrato", () => {
    expect(m.cet_anual_base).toBe("IMPLICITO");
    expect(m.cet_anual_base_mensal).toBe("7,5894%");
    expect(m.cet_anual_calculado).toBe("143,52%");
    expect(m.cet_anual_calculado_declarado).toBe("143,53%");
    expect(m.cet_anual_confere).toBe(true);
  });

  it("FINO-03 (D6): quadro da pág. 1 do dossiê é descritivo e fica fora da contagem", () => {
    const dossie = extraido.documentos_logicos.documentos.find((d) => d.tipo === "DOSSIE");
    expect(dossie.blocosAssinatura.map((b) => b.tipo)).toEqual(["QUADRO_DESCRITIVO"]);
    expect(extraido.assinatura.blocos_por_documento).toMatch(/Dossiê probatório \(págs\. 1 a 2\): quadro descritivo de assinatura, emitido pela instituição, na pág\. 1/);
    expect(extraido.assinatura.blocos_por_documento).toMatch(/Cédula de Crédito Bancário \(condições específicas\) \(págs\. 3 a 7\): bloco de assinatura na pág\. 6/);
    expect(extraido.assinatura.blocos_assinatura_total).toBe(2);
  });
});

describe("verificação de endereços, dois a dois", () => {
  const MANAQUIRI = { lat: -3.4417, lon: -60.4596, rotulo: "Manaquiri, AM", precisao: "municipio" };
  const PEDRO_II = { lat: -4.4257, lon: -41.4586, rotulo: "Pedro II - PI", precisao: "city" };
  const IP = { lat: -3.29972, lon: -60.62056, rotulo: "Manacapuru/Amazonas", precisao: "ip" };
  const GPS = { lat: -3.4340189, lon: -60.4593232, rotulo: "Manaquiri", precisao: "gps" };

  // D3 acrescentou o confronto B (GPS × município de emissão), que não depende da
  // residência e sobrevive à recusa da referência. São cinco pares agora.
  it("mede os pares e diz o que cada um compara", () => {
    const { pares } = montarConfrontoEnderecos({ instrumento: MANAQUIRI, laudo: PEDRO_II, ip: IP, gps: GPS, emissao: MANAQUIRI });
    const por = Object.fromEntries(pares.map((p) => [p.id, p]));
    expect(pares.map((p) => p.id)).toEqual(["ip-x-instrumento", "laudo-x-instrumento", "ip-x-laudo", "gps-x-ip", "gps-x-emissao"]);
    expect(por["laudo-x-instrumento"].km).toBeGreaterThan(2000);
    expect(por["gps-x-ip"].km).toBeCloseTo(23.3, 0);
    expect(por["ip-x-instrumento"].precisao).toBe("municipio");
    expect(pares.every((p) => p.texto && p.indisponivel === null)).toBe(true);
  });

  it("sem município de emissão, o confronto B fica não aferido e não some", () => {
    const { pares } = montarConfrontoEnderecos({ instrumento: MANAQUIRI, laudo: PEDRO_II, ip: IP, gps: GPS });
    const b = pares.find((p) => p.id === "gps-x-emissao");
    expect(b).toBeDefined();
    expect(b.km).toBeNull();
    expect(b.indisponivel).toContain("emissao");
  });

  it("par sem os dois pontos não vira zero: fica não aferido, dizendo o que falta", () => {
    const { pares } = montarConfrontoEnderecos({ instrumento: MANAQUIRI, laudo: null, ip: IP, gps: null });
    const por = Object.fromEntries(pares.map((p) => [p.id, p]));
    expect(por["laudo-x-instrumento"]).toMatchObject({ km: null, texto: null });
    expect(descreverIndisponibilidade(por["laudo-x-instrumento"])).toMatch(/endereço informado na geração do laudo não disponível/);
    expect(descreverIndisponibilidade(por["gps-x-ip"])).toMatch(/GPS da assinatura não disponível/);
  });

  it("pontos muito próximos não imprimem 0,00 km", () => {
    const { pares } = montarConfrontoEnderecos({ instrumento: MANAQUIRI, laudo: { ...MANAQUIRI }, ip: null, gps: null });
    expect(pares.find((p) => p.id === "laudo-x-instrumento").texto).toBe("menos de 0,1 km");
  });
});
