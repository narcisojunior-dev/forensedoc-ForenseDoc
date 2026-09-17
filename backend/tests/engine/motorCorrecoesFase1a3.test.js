import { describe, it, expect } from "vitest";
import { separarCarimboProcessual, paginaDoIndice } from "../../src/engine/carimboProcessual.js";
import { extrairDataContrato } from "../../src/engine/dataContrato.js";
import { taxaImplicita, anualizar, conferirAnualizacao, vencimentosMensais } from "../../src/engine/matematicaFinanceira.js";
import { extrairPlanilhaCalculo } from "../../src/engine/planilhaCalculo.js";
import { classificarProduto, extrairEmpregador } from "../../src/engine/produto.js";
import { avaliarNumeroDocumento, valorDeclaradoVazio } from "../../src/engine/camposSuspeitos.js";
import { avaliarConflitoReferencia, ufDoTexto } from "../../src/utils/referenciaResidencial.js";
import { verificarCoerencia } from "../../src/engine/coerenciaLaudo.js";
import { buildMathAudit, heuristicExtractionFromText } from "../../src/engine/extraction.js";

describe("carimbo processual", () => {
  const PROJUDI =
    "PROJUDI - Processo: 0600000-11.2025.8.04.5500 - Ref. mov. 1.6 - Assinado digitalmente por Carlos Eduardo Nunes\n" +
    "28/10/2025: JUNTADA DE PETIÇÃO DE INICIAL. Arq: DESCRITIVO DE CREDITO\n" +
    "3. LOCAL E DATA DE EMISSÃO: Manaquiri - AM - 25/06/2025\n" +
    "Cláusula com texto do contrato                                    Documento assinado digitalmente - TJAM\n" +
    "\fPROJUDI - Processo: 0600000-11.2025.8.04.5500 - Ref. mov. 1.6 - Assinado digitalmente por Carlos Eduardo Nunes\n" +
    "Segunda página";

  it("tira o carimbo do texto e guarda os metadados da juntada", () => {
    const r = separarCarimboProcessual(PROJUDI);
    expect(r.text).not.toMatch(/PROJUDI|JUNTADA|TJAM/);
    expect(r.text).toContain("Cláusula com texto do contrato");
    expect(r.metadados).toMatchObject({
      sistema: "PROJUDI", tribunal: "TJAM", movimento: "1.6", data_juntada: "28/10/2025",
      juntado_por: "Carlos Eduardo Nunes", descricao_movimento: "Juntada de petição de inicial",
    });
  });

  it("preserva a quebra de página da linha removida", () => {
    const r = separarCarimboProcessual(PROJUDI);
    expect(paginaDoIndice(r.text, r.text.indexOf("Segunda página"))).toBe(2);
  });

  it("texto sem carimbo não tem metadados processuais", () => {
    expect(separarCarimboProcessual("Contrato comum").metadados).toBeNull();
  });
});

describe("data do contrato por rótulo", () => {
  it("rótulo vence a primeira data do texto", () => {
    const r = extrairDataContrato("28/10/2025 texto\nLOCAL E DATA DE EMISSÃO: Manaquiri - AM - 25/06/2025", { datasSemRotulo: ["28/10/2025"] });
    expect(r).toMatchObject({ valor: "25/06/2025", confianca: "ALTA" });
  });

  it("datas rotuladas diferentes geram alerta de ambiguidade", () => {
    const r = extrairDataContrato("Data de emissão: 10/01/2024\nData do contrato: 12/01/2024");
    expect(r.valor).toBe("10/01/2024");
    expect(r.alertas.map((a) => a.codigo)).toContain("DAT1");
  });

  it("sem rótulo, nunca usa data do carimbo processual", () => {
    const r = extrairDataContrato("sem rótulo", { datasSemRotulo: ["28/10/2025", "01/02/2025"], datasProcessuais: ["28/10/2025"] });
    expect(r).toMatchObject({ valor: "01/02/2025", confianca: "BAIXA" });
  });

  it("rótulo com a data do carimbo rebaixa a confiança e alerta", () => {
    const r = extrairDataContrato("Data do contrato: 28/10/2025", { datasProcessuais: ["28/10/2025"] });
    expect(r.confianca).toBe("BAIXA");
    expect(r.alertas.map((a) => a.codigo)).toContain("DAT2");
  });
});

describe("matemática financeira", () => {
  const fluxos = vencimentosMensais(new Date(2025, 9, 1), 6).map((data) => ({ data, valor: 450 }));

  it("TIR com datas reais do dossiê C6", () => {
    const r = taxaImplicita({ valorPresenteAlvo: 1779.15, fluxos, dataBase: new Date(2025, 5, 25) });
    expect(r.status).toBe("AFERIDO");
    expect((r.taxa * 100).toFixed(4)).toBe("7.5894");
    expect(Math.abs(r.vplResidual)).toBeLessThan(0.01);
  });

  it("vencimento anterior à data base não vira taxa", () => {
    const r = taxaImplicita({ valorPresenteAlvo: 1779.15, fluxos, dataBase: new Date(2025, 9, 28) });
    expect(r.status).toBe("NAO_AFERIDO");
    expect(r.motivo).toMatch(/anterior à data base/);
  });

  it("taxa real acima de 20% ao mês é encontrada, e não cortada no teto antigo", () => {
    const r = taxaImplicita({ valorPresenteAlvo: 1000, fluxos, dataBase: new Date(2025, 8, 1) });
    expect(r.status).toBe("AFERIDO");
    expect(r.taxa).toBeGreaterThan(0.2);
  });

  it("fluxo impossível devolve motivo, nunca número", () => {
    // Parcelas zeradas: nenhuma taxa leva o valor presente ao alvo.
    const zerados = fluxos.map((f) => ({ ...f, valor: 0 }));
    const r = taxaImplicita({ valorPresenteAlvo: 1000, fluxos: zerados, dataBase: new Date(2025, 5, 25) });
    expect(r.status).toBe("NAO_AFERIDO");
    expect(r.taxa).toBeUndefined();
  });

  it("anualiza nas duas convenções e reconhece a do contrato", () => {
    expect((anualizar(0.075894).dias365 * 100).toFixed(2)).toBe("143.52");
    expect(conferirAnualizacao(0.0759, 1.4352)).toMatchObject({ confere: true, convencao: "365 dias" });
    expect(conferirAnualizacao(0.0506, 0.8086)).toMatchObject({ confere: true, convencao: "12 meses" });
    expect(conferirAnualizacao(0.0759, 1.2)).toMatchObject({ confere: false });
  });

  it("sem planilha, composição que não fecha fica não aferida", () => {
    const m = buildMathAudit({ valor_liberado: "R$ 1.779,15", iof_financiado: "R$ 36,07", valor_contratado: "R$ 2.033,86" });
    expect(m.composicao_confere).toBeNull();
    expect(m.composicao_nota).toMatch(/seguros/);
  });

  it("prazo nulo não aparece como zero declarado", () => {
    expect(buildMathAudit({ prazo_dias: null }).prazo_declarado_dias).toBeNull();
  });
});

describe("planilha de cálculo", () => {
  it("não confunde o rótulo solto do clausulado com planilha", () => {
    expect(extrairPlanilhaCalculo("o Valor Liberado será creditado em conta")).toBeNull();
  });
});

describe("produto e empregador", () => {
  it("nota de rodapé do INSS não vence marcadores de CLT", () => {
    const r = classificarProduto("INSTITUIÇÃO CONSIGNANTE / EMPREGADOR: 000007 - CONSIG TRAB. CG CLTv1.20250420. verbas rescisórias. *ratificadas pelo INSS/Dataprev");
    expect(r.codigo).toBe("CONSIGNADO_CLT");
  });

  it("benefício com espécie e número é INSS", () => {
    expect(classificarProduto("Espécie do benefício 41. Nº do benefício: 1234567890. INSS").codigo).toBe("CONSIGNADO_INSS");
  });

  it("CAD2 não dispara em consignado CLT e continua disparando em INSS sem número", () => {
    const clt = heuristicExtractionFromText("CÉDULA DE CRÉDITO BANCÁRIO EMPRÉSTIMO CONSIGNADO\n4. INSTITUIÇÃO CONSIGNANTE / EMPREGADOR: 000007 - CONSIG TRAB\nCG CLTv1.20250420");
    expect(clt.achados_irregularidade.map((a) => a.codigo)).not.toContain("CAD2");
    expect(clt.achados_irregularidade.map((a) => a.codigo)).toContain("EMP1");
    const inss = heuristicExtractionFromText("Contrato de empréstimo consignado em benefício do INSS. Espécie do benefício aposentadoria");
    expect(inss.achados_irregularidade.map((a) => a.codigo)).toContain("CAD2");
  });

  it("empregador com CNPJ na linha é identificado", () => {
    expect(extrairEmpregador("INSTITUIÇÃO CONSIGNANTE / EMPREGADOR: 000123 - ACME LTDA 11.222.333/0001-81").identificado).toBe(true);
  });
});

describe("campos suspeitos", () => {
  it("reconhece dígitos repetidos, sequência e DV inválido", () => {
    expect(avaliarNumeroDocumento("111111111111", "rg")).toEqual({ suspeito: true, motivo: "dígitos repetidos" });
    expect(avaliarNumeroDocumento("123456789", "rg").motivo).toBe("sequência numérica");
    expect(avaliarNumeroDocumento("111.444.777-36", "cpf").motivo).toBe("dígito verificador inválido");
    expect(avaliarNumeroDocumento("111.444.777-35", "cpf").suspeito).toBe(false);
  });

  it("marcas de campo não preenchido", () => {
    expect(valorDeclaradoVazio("Nao Informado , SD")).toBe(true);
    expect(valorDeclaradoVazio("N/I")).toBe(true);
    expect(valorDeclaradoVazio("Rua A, 10")).toBe(false);
  });
});

describe("conflito de referência residencial", () => {
  const cliente = { cidade: "Manaquiri", estado: "AM", cep: "69435-000" };
  const servicos = {
    geocodeAddress: async () => ({ lat: -3.4417, lon: -60.4596 }),
    reverseGeocode: async () => ({ municipio: "Pedro II", uf: "PI" }),
  };

  it("lê a UF de endereço livre", () => {
    expect(ufDoTexto("Rua X, 945 - Pedro II - PI - 64255-000")).toBe("PI");
    expect(ufDoTexto("Rua da Paz, Centro")).toBeNull();
  });

  it("coordenada manual em outra UF é conflito, via geocodificação reversa", async () => {
    const r = await avaliarConflitoReferencia({ cliente, pontoManual: { lat: -4.43, lon: -41.45 }, servicos });
    expect(r).toMatchObject({ motivo: "UF" });
  });

  it("mesma UF, mas longe do município do instrumento, é conflito por distância", async () => {
    const r = await avaliarConflitoReferencia({
      cliente,
      pontoManual: { lat: -3.1, lon: -64.8 },
      geoManual: { matchedUf: "AM", matchedCity: "Tefé" },
      servicos,
    });
    expect(r).toMatchObject({ motivo: "DISTANCIA" });
  });

  it("município vizinho dentro do limite não é conflito", async () => {
    const r = await avaliarConflitoReferencia({
      cliente,
      pontoManual: { lat: -3.3, lon: -60.2 },
      geoManual: { matchedUf: "AM", matchedCity: "Careiro" },
      servicos,
    });
    expect(r).toBeNull();
  });
});

describe("validação cruzada do laudo", () => {
  it("detecta as contradições do laudo homologado", () => {
    const extracted = {
      cliente: { cidade: "Manaquiri" },
      contrato: { data_contrato: "28/10/2025", produto_codigo: "CONSIGNADO_CLT" },
      metadados_processuais: { data_juntada: "28/10/2025" },
      assinatura: {
        metodos_mencionados_clausulado: ["Biometria mencionada apenas no clausulado/modelo contratual"],
        biometria_registrada_como_evento: true,
        codigo_autenticacao_declarado: null,
        hash_documento_assinado: null,
        hash_declarado_estado: "DECLARADO_NAO_CONFERIVEL",
      },
      afericao_matematica: { cet_implicito_mensal_numero: 0.2 },
      achados_irregularidade: [{ codigo: "CAD2" }],
    };
    const result = {
      home: { estado_confronto: "RECUSADO_CONFLITO" },
      contractGeo: { distance: 2111.2 },
      sumarioIrregularidades: {
        allFindings: [{ key: "gps-outro-municipio", text: "cai em Manaquiri/AM, município diferente do domicílio do cliente (Pedro II/PI, residência de referência)" }],
      },
    };
    const regras = verificarCoerencia(result, extracted).map((v) => v.regra);
    expect(regras).toEqual(expect.arrayContaining([
      "domicilio-sumario-x-qualificacao",
      "biometria-clausulado-x-artefato",
      "codigo-autenticacao-x-estado",
      "cet-implicito-no-extremo",
      "data-contrato-x-juntada",
      "distancia-com-referencia-recusada",
      "produto-clt-x-beneficio-inss",
    ]));
  });
});
