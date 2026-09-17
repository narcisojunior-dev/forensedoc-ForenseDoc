import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Testes negativos obrigatórios do relatório de homologação do laudo
 * FD-20260916-ABC18B73E5 (dossiê C6 Consig, relatório-motor-novo.md).
 *
 * Cada `it` prende uma afirmação falsa que o laudo levou ao juízo. O texto vem
 * do caso anonimizado do corpus; o geocodificador é simulado, com Pedro II/PI e
 * Manaquiri/AM nas coordenadas reais dos municípios.
 *
 * O negativo 8 do relatório ("CCB sem bloco de assinatura") foi invertido: a
 * conferência do PDF mostrou bloco de assinatura no fim da pág. 6 da CCB, e o
 * teste garante que o achado falso NÃO sai. Ver seção 11 do plano.
 */

const geocodeAddress = vi.fn();
const reverseGeocode = vi.fn();
vi.mock("../src/services/geocodingService.js", () => ({ geocodeAddress, reverseGeocode }));
vi.mock("../src/services/apiService.js", () => ({ getIpInfo: vi.fn(async () => null) }));
vi.mock("../src/services/rdapService.js", () => ({ lookupRdapIp: vi.fn(async () => null) }));
vi.mock("../src/services/ipHistoryService.js", () => ({ lookupIpHistory: vi.fn(async () => null) }));

const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { enrichGeography } = await import("../src/services/geoEnrichmentService.js");
const { fundamentacaoPara } = await import("../src/reports/laudoTexts.js");
const { verificarCoerencia } = await import("../src/engine/coerenciaLaudo.js");

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus/casos/c6-consig-clt-dossie.json");
const { texto } = JSON.parse(await readFile(CASO, "utf8"));
const extraido = heuristicExtractionFromText(texto);

const PEDRO_II = { lat: -4.4257, lon: -41.4586, matchedCity: "Pedro II", matchedUf: "PI", precision: "city" };
const MANAQUIRI = { lat: -3.4417, lon: -60.4596, matchedCity: "Manaquiri", matchedUf: "AM", precision: "city" };

beforeEach(() => {
  geocodeAddress.mockReset();
  reverseGeocode.mockReset();
  geocodeAddress.mockImplementation(async (q) => (/Pedro II|PI\b|64255/i.test(q) ? PEDRO_II : /Manaquiri|69435/i.test(q) ? MANAQUIRI : null));
  reverseGeocode.mockImplementation(async () => ({ municipio: "Manaquiri", uf: "AM" }));
});

describe("dossiê C6: testes negativos do relatório de homologação", () => {
  it("1. não devolve a data da juntada (28/10/2025) como data do contrato", () => {
    expect(extraido.contrato.data_contrato).not.toBe("28/10/2025");
    expect(extraido.contrato.data_contrato).toBe("25/06/2025");
    expect(extraido.contrato.data_contrato_origem).toMatch(/LOCAL E DATA DE EMISSÃO.*pág\. 3/);
    expect(extraido.metadados_processuais.data_juntada).toBe("28/10/2025");
  });

  it("2. não calcula distância a partir de endereço manual em UF diversa da extraída", async () => {
    const geo = await enrichGeography(extraido, "Rua Alcides Araújo Mourão, 945 - Pedro II - PI - 64255-000", null);
    expect(geo.home.estado_confronto).toBe("RECUSADO_CONFLITO");
    expect(geo.home.geo).toBeNull();
    expect(geo.home.alerta).toMatch(/CONFRONTO RECUSADO: conflito entre endereço informado \(PI\) e endereço extraído do instrumento \(AM\)/);
    expect(geo.contractGeo?.distance ?? null).toBeNull();
    expect(geo.ipAnalysis.every((ip) => ip.distance === null)).toBe(true);
  });

  it("2b. sem endereço manual, o confronto fica indisponível porque o instrumento não registrou o endereço", async () => {
    const geo = await enrichGeography(extraido, "", null);
    expect(geo.home.estado_confronto).toBe("INDISPONIVEL_NAO_INFORMADO");
    expect(geo.home.alerta).toMatch(/Nao Informado, SD/);
    expect(geo.home.alerta).toMatch(/Manaquiri, AM, 69435-000/);
    expect(geo.home.geo).toBeNull();
  });

  it("2c. conflito liberado pelo operador só com justificativa, que vai para o laudo", async () => {
    const justificativa = "Cliente reside em Pedro II desde 2019, conforme comprovante juntado.";
    const geo = await enrichGeography(extraido, "Pedro II - PI", null, { contestado: true, justificativa });
    expect(geo.home.estado_confronto).toBe("LIBERADO_PELO_OPERADOR");
    expect(geo.home.geo).not.toBeNull();
    expect(geo.home.alerta).toContain(justificativa);
  });

  it("3. não devolve CET implícito de 20% nem valor no extremo do intervalo de busca", () => {
    const m = extraido.afericao_matematica;
    expect(m.cet_implicito_mensal).not.toBe("20,0000%");
    expect(m.cet_implicito_mensal).toBe("7,5894%");
    expect(m.cet_implicito_veredito).toBe("Confere");
    expect(m.cet_implicito_nota).not.toMatch(/subdeclara[cç][aã]o;/i);
  });

  it("4. não acusa divergência na composição do financiado", () => {
    expect(extraido.afericao_matematica.composicao_confere).toBe(true);
    expect(extraido.afericao_matematica.composicao_financiado_calculada).toBe("R$ 2.033,86");
    expect(extraido.contrato.seguros).toBe("R$ 218,64");
  });

  it("5. não acusa divergência na anualização do CET nem na dos juros", () => {
    const m = extraido.afericao_matematica;
    expect(m.cet_anual_confere).toBe(true);
    expect(m.cet_anual_convencao).toBe("365 dias");
    expect(m.juros_anual_confere).toBe(true);
  });

  it("6. não cita Lei 8.213/1991 nem normas do INSS no bloco normativo", () => {
    expect(extraido.contrato.produto_codigo).toBe("CONSIGNADO_CLT");
    const normas = JSON.stringify(fundamentacaoPara(extraido.contrato.produto_codigo));
    expect(normas).not.toMatch(/8\.213|INSS/);
    expect(extraido.achados_irregularidade.map((a) => a.codigo)).not.toContain("CAD2");
    expect(extraido.achados_irregularidade.find((a) => a.codigo === "EMP1")?.texto).toMatch(/000007 - CONSIG TRAB/);
  });

  it("7. não afirma que a biometria foi apenas mencionada no clausulado", () => {
    expect(extraido.assinatura.metodos_mencionados_clausulado.join(" ")).not.toMatch(/biometr/i);
    expect(extraido.assinatura.biometria_registrada_como_evento).toBe(true);
  });

  it("protocolo de autenticidade não é tratado como hash declarado", () => {
    expect(extraido.assinatura.hash_documento_assinado).toBeNull();
    expect(extraido.assinatura.codigo_autenticacao_declarado).toBe("3b9e2c1a-7d4f-4e8a-9c21-5f6d7e8a9b0c");
    expect(extraido.assinatura.codigo_autenticacao_origem).toMatch(/pág\. 2/);
    const int1 = extraido.achados_irregularidade.find((a) => a.codigo === "INT1");
    expect(int1.gravidade).toBe("ALTA");
    expect(int1.texto).toMatch(/autoverificação/);
  });

  it("somatório confere e prazo diverge (6 meses declarados, 249 dias efetivos)", () => {
    const m = extraido.afericao_matematica;
    expect(m.somatorio_confere).toBe(true);
    expect(m.prazo_descricao).toBe("declarado 6 meses, efetivo 249 dias (8,3 meses)");
    expect(m.prazo_confere).toBe(false);
  });

  it("campos cadastrais fictícios ou vazios viram achado sobre o instrumento", () => {
    const e = extraido.cliente.estados_campos;
    expect(e.rg).toMatchObject({ estado: "LOCALIZADO_SUSPEITO", valor: "111111111111", motivo: "dígitos repetidos" });
    expect(e.endereco).toMatchObject({ estado: "LOCALIZADO_VAZIO", valor: "Nao Informado, SD" });
    expect(extraido.achados_irregularidade.map((a) => a.codigo)).toContain("CAD4");
  });

  it("o resultado montado para o fixture não traz contradição entre seções", async () => {
    const geo = await enrichGeography(extraido, "Pedro II - PI", null);
    expect(verificarCoerencia({ ...geo }, extraido)).toEqual([]);
  });

  it("8. (errata) não afirma ausência de assinatura na CCB, que tem bloco na pág. 6", () => {
    expect(extraido.achados_irregularidade.map((a) => a.codigo)).not.toContain("ASS1");
    const ccb = extraido.documentos_logicos.documentos.find((d) => d.tipo === "INSTRUMENTO_PRINCIPAL");
    expect(ccb).toMatchObject({ paginaInicial: 3, paginaFinal: 7 });
    expect(ccb.blocosAssinatura.map((b) => b.pagina)).toEqual([6]);
    expect(extraido.assinatura.mencao_textual_documento).toMatch(/Cédula.*pág\. 6/);
  });

  it("segmenta o dossiê nos cinco documentos lógicos", () => {
    expect(extraido.documentos_logicos.documentos.map((d) => [d.tipo, d.paginaInicial, d.paginaFinal])).toEqual([
      ["DOSSIE", 1, 2],
      ["INSTRUMENTO_PRINCIPAL", 3, 7],
      ["CONDICOES_GERAIS", 8, 14],
      ["SEGURO", 15, 17],
      ["TERMOS", 18, 27],
    ]);
  });

  it("9. emite achado de ausência de comprovante de transferência", () => {
    const lib1 = extraido.achados_irregularidade.find((a) => a.codigo === "LIB1");
    expect(lib1.gravidade).toBe("ALTA");
    expect(lib1.texto).toMatch(/Banco 237, agência 1234, conta 005555-1\), no valor de R\$ 1\.779,15/);
  });

  it("10. emite o bloco de seguro prestamista com os seis achados", () => {
    const s = extraido.seguro_prestamista;
    expect(s).toMatchObject({ proposta: "900112233", premio: "R$ 218,64", iof: "R$ 0,83", pro_labore: "R$ 98,02", beneficiario: "Estipulante" });
    expect(s.coberturas.map((c) => [c.nome, c.premio, c.carencia_dias, c.franquia_dias, c.teto_parcelas])).toEqual([
      ["Morte", "R$ 11,46", 0, 0, null],
      ["Invalidez Permanente Total por Acidente", "R$ 2,67", 0, 0, null],
      ["Desemprego Involuntario (DI)", "R$ 204,52", 90, 31, 4],
    ]);
    expect(s.seguradora.cnpj).toBe("02.102.498/0001-29");
    expect(s.corretora).toEqual({ nome: "Nova Casa do Corretor", cnpj: "07.340.832/0001-04", susep: "202037842" });
    expect(s.achados.map((a) => a.codigo)).toEqual(["SEG1", "SEG2", "SEG3", "SEG4", "SEG5", "SEG6"]);
    expect(s.achados[0].gravidade).toBe("ALTA");
  });

  it("reconstrói a trilha: 6 eventos, 204 s, aceites rápidos, ausências e fuso", () => {
    const t = extraido.trilha_eventos;
    expect(t.eventos).toHaveLength(6);
    expect(t.duracao_total_s).toBe(204);
    expect(t.eventos.filter((e) => !e.ip)).toHaveLength(2);
    expect(t.eventos.filter((e) => e.lat === null)).toHaveLength(3);
    expect(t.eventos[2]).toMatchObject({ porta: "56256" });
    const codigos = extraido.achados_irregularidade.map((a) => a.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["TRL1-TERMOS", "TRL1-CCB", "TRL1-SEGURO", "TRL3", "TZ1"]));
    expect(extraido.achados_irregularidade.find((a) => a.codigo === "TZ1").texto).toMatch(/06:45:03 no horário de Manaus/);
  });
});
