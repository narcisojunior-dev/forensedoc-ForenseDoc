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
// IP da trilha geolocalizado em Manacapuru/AM, como no laudo da rodada 2.
vi.mock("../src/services/apiService.js", () => ({
  getIpInfo: vi.fn(async () => ({ lat: -3.2999, lon: -60.6206, city: "Manacapuru", region: "Amazonas", country: "Brasil", isp: "TELEFÔNICA BRASIL S.A", source: "teste" })),
}));
vi.mock("../src/services/rdapService.js", () => ({ lookupRdapIp: vi.fn(async () => null) }));
vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
  mapPointsDeclaredVsIp: () => [],
}));
vi.mock("../src/services/ipHistoryService.js", () => ({ lookupIpHistory: vi.fn(async () => null) }));

const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { enrichGeography } = await import("../src/services/geoEnrichmentService.js");
const { fundamentacaoPara } = await import("../src/reports/laudoTexts.js");
const { verificarCoerencia } = await import("../src/engine/coerenciaLaudo.js");
const { buildSummaryForResult, recomputeDerived } = await import("../src/services/analysisRecompute.js");
const { montarConfrontoGeografico } = await import("../src/utils/distancia.js");
const { calculateForensicScore } = await import("../src/utils/forensicScore.js");
const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { extractPdfTextDetailed } = await import("../src/services/pdfService.js");

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

  it("7. não afirma que a biometria foi apenas descrita no instrumento", () => {
    const rotulos = extraido.assinatura.metodos_descritos_no_fluxo.map((m) => m.rotulo).join(" ");
    expect(rotulos).toMatch(/biometr/i);
    expect(rotulos).not.toMatch(/apenas|somente/i);
    expect(extraido.assinatura.biometria_registrada_como_evento).toBe(true);
  });

  // D1: o § 4 do laudo FD-20260917 afirmou "SMS Token · E-mail" para este
  // dossiê, que não contém a palavra "token" em nenhuma das 27 páginas.
  it("7.1. não afirma fator de autenticação ausente do material", () => {
    expect(JSON.stringify(extraido.assinatura)).not.toMatch(/SMS\s*Token/i);
    expect(extraido.assinatura.metodos_descritos_estado).toBe("LOCALIZADO");
  });

  it("protocolo de autenticidade não é tratado como hash declarado", () => {
    expect(extraido.assinatura.hash_documento_assinado).toBeNull();
    expect(extraido.assinatura.codigo_autenticacao_declarado).toBe("3b9e2c1a-7d4f-4e8a-9c21-5f6d7e8a9b0c");
    expect(extraido.assinatura.codigo_autenticacao_origem).toMatch(/pág\. 2/);
    const int1 = extraido.achados_irregularidade.find((a) => a.codigo === "INT1");
    expect(int1.gravidade).toBe("ALTA");
    expect(int1.texto).toMatch(/autoverificação/);
  });

  /**
   * D4: o campo do instrumento é "Prazo Total: 6 meses ou até o pagamento da
   * última parcela, o que acontecer por último". A ressalva está dentro do mesmo
   * campo que o laudo leu, e o comparador descartava o resto do token. Campo
   * condicional não declara prazo fechado, logo não há divergência a afirmar: o
   * desfecho é inconclusivo e o achado muda de natureza (PRZ2).
   */
  it("somatório confere e o prazo sai como condicional, não como divergente", () => {
    const m = extraido.afericao_matematica;
    expect(m.somatorio_confere).toBe(true);
    expect(m.prazo_confere).toBeNull();
    expect(m.prazo_declarado_condicional).toBe(true);
    expect(m.prazo_descricao).toMatch(/declarado de forma condicional/);
    expect(m.prazo_descricao).toMatch(/efetivo 249 dias \(8,3 meses\)/);
  });

  it("campos cadastrais fictícios ou vazios viram achado sobre o instrumento", () => {
    const e = extraido.cliente.estados_campos;
    expect(e.rg).toMatchObject({ estado: "LOCALIZADO_SUSPEITO", valor: "111111111111", motivo: "dígitos repetidos" });
    expect(e.endereco).toMatchObject({ estado: "LOCALIZADO_VAZIO", valor: "Nao Informado, SD" });
    expect(extraido.achados_irregularidade.map((a) => a.codigo)).toContain("CAD4");
  });

  describe("rodada 2: CRIT-01 e CRIT-02 com o endereço manual conflitante", () => {
    const montarResultado = async () => {
      const geo = await enrichGeography(extraido, "Rua Alcides Araújo Mourão, 945, Santa fé - Pedro II - PI, 64255-000", null);
      const result = { ...geo, reportId: "FD-TESTE", hashes: {}, file: { name: "dossie.pdf", sizeBytes: 1 } };
      result.confronto_geografico = montarConfrontoGeografico(result);
      result.sumarioIrregularidades = buildSummaryForResult(result, extraido);
      return recomputeDerived(result, extraido);
    };

    it("negativo 1: nenhuma seção do sumário contém 0,00 km", async () => {
      const r = await montarResultado();
      expect(r.confronto_geografico.status).toBe("RECUSADO_CONFLITO");
      expect(JSON.stringify(r.sumarioIrregularidades)).not.toMatch(/0,00 km/);
    });

    it("negativo 2: sem achado de proximidade nem selo derivado de distância à residência", async () => {
      const r = await montarResultado();
      const s = r.sumarioIrregularidades;
      const chaves = [...s.allFindings, ...s.favorable].map((f) => f.key);
      expect(chaves).not.toContain("gps-near-home");
      expect(chaves).not.toContain("gps-home-distance");
      expect(s.ipCards.map((c) => c.text).join(" ")).not.toMatch(/km da referência residencial/);
      expect(s.checks.find((c) => c.key === "gps-residencia")).toMatchObject({ status: "INDETERMINADO" });
    });

    it("negativo 3: nenhum ponto do gráfico mede a residência; os pares de endereços dizem o que comparam", async () => {
      const r = await montarResultado();
      const geo = r.sumarioIrregularidades.geo;
      expect(geo.modo).toBe("pares");
      expect(geo.items.every((i) => i.referencia === "par")).toBe(true);
      const ids = geo.items.map((i) => i.par);
      expect(ids).toEqual(expect.arrayContaining(["ip-x-instrumento", "laudo-x-instrumento", "ip-x-laudo", "gps-x-ip"]));
      expect(geo.items.find((i) => i.par === "gps-x-ip").distance).toBeCloseTo(r.confronto_geografico.gps_ip, 5);
      // O endereço informado no laudo (Pedro II/PI) contra o instrumento (Manaquiri/AM).
      expect(geo.items.find((i) => i.par === "laudo-x-instrumento").distance).toBeGreaterThan(2000);
      expect(geo.description).toMatch(/nível de município/);
      expect(geo.description).toMatch(/não é usado como domicílio/);
    });

    it("a distância entre GPS e IP, independente da residência, continua disponível", async () => {
      const r = await montarResultado();
      expect(r.confronto_geografico.gps_ip).toBeGreaterThan(0);
      expect(r.confronto_geografico.distancias.gps_residencia).toBeNull();
    });

    it("a capa do PDF não afirma compatibilidade com o domicílio", async () => {
      const r = await montarResultado();
      const c = r.confronto_geografico;
      const score = calculateForensicScore({ distKmIp: c.distancias.ips_residencia[0]?.km ?? null, distKmGps: c.distancias.gps_residencia, distKmIpVsGps: c.gps_ip });
      expect(score).toMatchObject({ score: null, nivel: "NÃO AFERIDO" });
    });

    it("sem contradição crítica no resultado corrigido", async () => {
      const r = await montarResultado();
      expect(verificarCoerencia(r, extraido).filter((v) => v.nivel === "CRITICA")).toEqual([]);
    });

    it("negativos 4 e 5 (MED-01): § 5 do PDF com um único motivo e sem \"endereço adotado\"", async () => {
      const r = await montarResultado();
      expect(r.home.endereco_nao_informado).toBe(true);
      expect(r.home.alerta).toMatch(/essa lacuna é atribuível à instituição/);
      const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, {
        ...r,
        text: JSON.stringify(extraido),
        metadata: { warnings: [] },
        hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
        generatedAt: new Date().toISOString(),
      });
      const partes = [];
      for await (const p of doc) partes.push(p);
      const { text } = await extractPdfTextDetailed(Buffer.concat(partes));
      const plano = text.replace(/\s+/g, " ");
      expect(plano).toMatch(/Endereço informado, não utilizado/);
      expect(plano).not.toMatch(/Endereço \(Informado manualmente\)|Endereço adotado|Coordenada adotada/);
      expect(plano).not.toMatch(/tente novamente|Verifique a grafia/);
      expect(plano.match(/CONFRONTO RECUSADO/g)).toHaveLength(1);
      // A verificação geográfica que não depende da residência continua no PDF.
      expect(plano).toMatch(/Confronto 3 · geolocalização declarada × origem da conexão \(IP\)/);
      // Capa: domicílio pela qualificação do instrumento e GPS do ato presente.
      expect(plano).toMatch(/Domicílio do titular: Manaquiri\/AM \(qualificação do instrumento; o endereço informado não foi utilizado\)/);
      expect(plano).toMatch(/GPS registrado no ato: Manaquiri\/AM \(-?\d/);
      expect(plano).not.toMatch(/Domicílio do titular: Rua|GPS registrado no ato: Não registrado/);
      expect(plano).toMatch(/Distância entre GPS declarado e consulta do IP: cerca de \d+ km · DISTÂNCIA DESCRITIVA/);
    });

    it("o validador acusa o sumário do laudo da rodada 2 (0,00 km em selo favorável)", async () => {
      const r = await montarResultado();
      r.sumarioIrregularidades = {
        ...r.sumarioIrregularidades,
        favorable: [{ severity: "FAVORÁVEL", key: "gps-near-home", title: "GPS da assinatura próximo à referência residencial.", text: "A coordenada da assinatura fica a 0,00 km do endereço de referência." }],
        geo: { ...r.sumarioIrregularidades.geo, items: [{ label: "GPS · assinatura", distance: 0, role: "gps" }] },
      };
      const regras = verificarCoerencia(r, extraido).filter((v) => v.nivel === "CRITICA").map((v) => v.regra);
      expect(regras).toEqual(expect.arrayContaining(["distancia-no-sumario-sem-confronto"]));
    });
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

  it("10. emite o bloco de seguro prestamista com os oito achados e marcos distintos", () => {
    const s = extraido.seguro_prestamista;
    expect(s).toMatchObject({ proposta: "900112233", premio: "R$ 218,64", iof: "R$ 0,83", pro_labore: "R$ 98,02", beneficiario: "Estipulante" });
    expect(s.coberturas.map((c) => [c.nome, c.premio, c.carencia_dias, c.franquia_dias, c.teto_parcelas])).toEqual([
      ["Morte", "R$ 11,46", 0, 0, null],
      ["Invalidez Permanente Total por Acidente", "R$ 2,67", 0, 0, null],
      ["Desemprego Involuntario (DI)", "R$ 204,52", 90, 31, 4],
    ]);
    expect(s.seguradora.cnpj).toBe("02.102.498/0001-29");
    expect(s.corretora).toEqual({ nome: "Nova Casa do Corretor", cnpj: "07.340.832/0001-04", susep: "202037842" });
    // SEG8 é a soma das coberturas contra o prêmio total (D10). SEG7 continua
    // reservado ao prêmio da proposta contra o seguro da planilha, que neste
    // dossiê não diverge.
    expect(s.achados.map((a) => a.codigo)).toEqual(["SEG1", "SEG2", "SEG3", "SEG4", "SEG5", "SEG6", "SEG9", "SEG8"]);
    // Certificado e data do sinistro não foram apresentados: não inventar vigência.
    expect(s.achados[0].gravidade).toBe("INFO");
    expect(s.vigencia.premissa_origem).toBe("INDETERMINADO");
    expect(s.vigencia.inicio_declarado).toBeNull();
    expect(s.achados[0].texto).not.toContain("121 dias");
    expect(s.vigencia.remissao_ao_certificado).toMatch(/certificado/i);
    expect(s.achados[0].texto).toMatch(/certificado (individual|do seguro)/i);
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
