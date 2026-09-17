import { test } from "vitest";
import assert from "node:assert/strict";
import { buildIrregularitySummary, classifyIpRole } from "../../src/engine/irregularitySummary.js";

function baseReport(overrides = {}) {
  const report = {
    reportId: "FD-TESTE-001",
    file: { name: "contrato.pdf", sizeKB: "100.00" },
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    metadata: { totalPages: 2, title: "Contrato", author: "Cliente", subject: "Crédito", creator: "Portal", producer: "Portal", hasEmbeddedSignatures: true, warnings: [] },
    extracted: {
      contrato: { numero: "123", banco: "Banco Exemplo", valor_contratado: "R$ 1.000", valor_parcela: "R$ 100", numero_parcelas: "10", taxa_juros_mensal: "1%", taxa_juros_anual: "12%", cet_mensal: "1,2%", cet_anual: "15%", data_contrato: "01/01/2024", data_primeiro_vencimento: "01/02/2024", data_ultimo_vencimento: "01/11/2024" },
      cliente: { nome: "Cliente Teste", cpf: "000.000.000-00", rg: "1", data_nascimento: "01/01/1960", endereco: "Rua A", bairro: "Centro", cidade: "Teresina", estado: "PI", cep: "64000-000", telefone: "(86) 99999-0000", numero_beneficio: "1" },
      assinatura: { presente: true, tipo: "Avançada", data_hora_assinatura: "01/01/2024 10:00", metodos_autenticacao: ["Biometria"], hash_documento_assinado: "A".repeat(64), integridade_pos_assinatura: true },
      cadeia_custodia: { identificacao_signatario: true, registro_ip: true, carimbo_tempo: true, geolocalizacao: true, metodo_autenticacao: true, hash_integridade: true, trilha_auditoria: true, evidencia_aceite: true },
      trilha_acesso: { eventCount: 2, uniqueIps: ["177.1.1.1"], deviceIdentifiable: true },
      evidencias_irregularidade: [],
    },
    home: { geo: { lat: -5.08, lon: -42.82 }, query: "Teresina - PI" },
    contractGeo: { lat: -5.081, lon: -42.821, distance: 0.2, endereco: "Teresina - PI" },
    geoDeclaredPresent: true,
    ipAnalysis: [{ endereco: "177.1.1.1", contexto: "Histórico de Ações", geo: { lat: -5.09, lon: -42.81, city: "Teresina", region: "Piauí", country: "Brasil", isp: "TIM" }, distance: 1.5 }],
  };
  return { ...report, ...overrides, extracted: { ...report.extracted, ...(overrides.extracted || {}) } };
}

test("1/5 - contrato coerente mantém oito domínios e pontos favoráveis", () => {
  const summary = buildIrregularitySummary(baseReport());
  assert.equal(summary.counts.domains, 8);
  assert.equal(new Set(summary.checks.map((item) => item.domain)).size, 8);
  assert.ok(summary.favorable.some((item) => item.key === "hash-ok"));
  assert.ok(summary.favorable.some((item) => item.key === "gps-ip-compatible"));
});

test("2/5 - fixture Safra reproduz os alertas centrais do checklist", () => {
  const report = baseReport({
    hashes: { sha256: "C".repeat(64), sha1: "D".repeat(40) },
    metadata: { totalPages: 2, title: null, author: null, subject: null, creator: null, producer: "iText 7.1.3, modified using iText", hasEmbeddedSignatures: false, warnings: [] },
    extracted: {
      contrato: { numero: "25422513", banco: "Banco Safra", data_contrato: "14/03/2022", data_primeiro_vencimento: "14/03/2022", data_ultimo_vencimento: "03/14/2022" },
      cliente: { cpf: "217.252.093-49", cidade: "131910d0f2bab2c131910d0f2bab2c", cep: "25422513", email: "safra@safra.com.br" },
      assinatura: { presente: true, tipo: "Indeterminado", data_hora_assinatura: "14/03/2022 15:26", metodos_autenticacao: ["Biometria", "E-mail"], hash_documento_assinado: "F".repeat(64) },
      cadeia_custodia: { identificacao_signatario: true, registro_ip: true, carimbo_tempo: true, geolocalizacao: true, metodo_autenticacao: true, hash_integridade: true, trilha_auditoria: true, evidencia_aceite: true },
      trilha_acesso: { eventCount: 2, uniqueIps: ["177.51.75.96"], deviceIdentifiable: false },
    },
    contractGeo: { lat: -5.082355, lon: -42.819149, distance: 0.19, endereco: "Teresina - PI" },
    ipAnalysis: [
      { endereco: "177.51.75.96", contexto: "Histórico de Ações", geo: { lat: -3.73, lon: -38.52, city: "Fortaleza", region: "Ceará", country: "Brasil", isp: "TIM" }, distance: 499 },
      { endereco: "189.38.114.70", contexto: "servidor", geo: { lat: -23.55, lon: -46.63, city: "São Paulo", region: "São Paulo", country: "Brasil", isp: "Banco Safra" }, distance: 2094 },
      { endereco: "2.16.189.7", contexto: "CDN", geo: { lat: 37.98, lon: 23.72, city: "Atenas", country: "Grécia", isp: "Akamai" }, distance: 8345 },
    ],
  });
  const summary = buildIrregularitySummary(report);
  const keys = new Set(summary.allFindings.map((item) => item.key));
  for (const key of ["hash-mismatch", "economics-missing", "dates-collapsed", "client-qualification", "gps-ip-conflict"]) assert.ok(keys.has(key), key);
  assert.equal(summary.ipCards.find((ip) => ip.endereco === "177.51.75.96").role, "access");
  assert.equal(summary.ipCards.find((ip) => ip.endereco === "2.16.189.7").role, "cdn");
});

test("3/5 - ausência de dados gera cautelas sem inventar coordenadas ou IP", () => {
  const summary = buildIrregularitySummary({ reportId: "FD-VAZIO", file: { name: "vazio.pdf" }, hashes: {}, extracted: { contrato: {}, cliente: {}, assinatura: { presente: false }, cadeia_custodia: {} }, ipAnalysis: [] });
  assert.ok(summary.allFindings.some((item) => item.key === "signature-absent"));
  assert.equal(summary.geo.items.length, 0);
  assert.equal(summary.ipCards.length, 0);
  assert.match(summary.synthesis, /ausência integral de trilha/i);
});

test("4/5 - IPs de banco e CDN não são tratados como localização do consumidor", () => {
  const report = baseReport({
    extracted: { contrato: { ...baseReport().extracted.contrato, banco: "Banco Safra" }, trilha_acesso: { eventCount: 0, uniqueIps: [] } },
  });
  assert.equal(classifyIpRole({ endereco: "1.1.1.1", contexto: "Servidor", geo: { isp: "Banco Safra" } }, report), "bank");
  assert.equal(classifyIpRole({ endereco: "2.2.2.2", contexto: "recurso web", geo: { isp: "Akamai Technologies" } }, report), "cdn");
});

test("5/5 - cronologia e dispositivo são convertidos em achados e diligência", () => {
  const report = baseReport({
    extracted: { trilha_acesso: { eventCount: 14, uniqueIps: ["177.1.1.1"], chronologyInconsistent: true, firstTime: "16:15", lastTime: "16:18", deviceIdentifiable: false, device: "Android 10 · Chrome 109" } },
  });
  const summary = buildIrregularitySummary(report);
  const keys = new Set(summary.allFindings.map((item) => item.key));
  assert.ok(keys.has("chronology"));
  assert.ok(keys.has("device-gap"));
  assert.ok(summary.diligences.some((item) => item.key === "device"));
});

test("6/6 - cartão consignado (RMC) não acusa instrumento sem números essenciais", () => {
  const report = baseReport({
    extracted: {
      contrato: {
        numero: "66627014",
        banco: "Facta Financeira S.A. Crédito, Financiamento e Investimento",
        modalidade: "RMC",
        valor_contratado: null,
        valor_parcela: null,
        numero_parcelas: null,
        prazo_meses: 84,
        taxa_juros_mensal: "2,83%",
        taxa_juros_anual: "39,78%",
        cet_mensal: "2,90%",
        cet_anual: "41,54%",
        cartao: {
          limiteCartao: "R$ 2.008,09",
          valorMaximoSaque: "R$ 1.405,66",
          valorConsignadoMensal: "R$ 46,20",
        },
        data_contrato: "17/10/2023",
        data_primeiro_vencimento: null,
        data_ultimo_vencimento: null,
      },
    },
  });
  const summary = buildIrregularitySummary(report);
  const keys = new Set(summary.allFindings.map((item) => item.key));
  assert.equal(keys.has("economics-missing"), false);
});

test("7/7 - GPS a 41 km em outro município gera achado, mesmo 'favorável' pela régua de distância", () => {
  const report = baseReport({
    extracted: { cliente: { cidade: "Boa Hora", estado: "PI" } },
    contractGeo: { lat: -4.276, lon: -41.7788, distance: 41, endereco: "Piripiri - PI", municipio: "Piripiri", uf: "PI" },
  });
  const summary = buildIrregularitySummary(report);
  const keys = new Set(summary.allFindings.map((item) => item.key));
  assert.ok(keys.has("gps-outro-municipio"));
  const finding = summary.allFindings.find((item) => item.key === "gps-outro-municipio");
  assert.match(finding.text, /Piripiri/);
  assert.match(finding.text, /Boa Hora/);
});

test("8/8 - GPS no mesmo município não gera achado de município divergente", () => {
  const report = baseReport({
    extracted: { cliente: { cidade: "Teresina", estado: "PI" } },
    contractGeo: { lat: -5.081, lon: -42.821, distance: 0.2, endereco: "Teresina - PI", municipio: "Teresina", uf: "PI" },
  });
  const summary = buildIrregularitySummary(report);
  const keys = new Set(summary.allFindings.map((item) => item.key));
  assert.equal(keys.has("gps-outro-municipio"), false);
});

test("município diverso usa a residência de referência geocodificada, quando conhecida", () => {
  const summary = buildIrregularitySummary({
    extracted: { contrato: {}, cliente: { cidade: "Manaquiri", estado: "AM" }, assinatura: {} },
    home: { geo: { lat: -4.43, lon: -41.45, matchedCity: "Pedro II", matchedUf: "PI" } },
    contractGeo: { lat: -3.43, lon: -60.46, municipio: "Manaquiri", uf: "AM", distance: 2111 },
    ipAnalysis: [],
  });
  const achado = summary.allFindings.find((f) => f.key === "gps-outro-municipio");
  assert.ok(achado, "achado de município diverso ausente");
  assert.match(achado.text, /Pedro II\/PI, residência de referência/);
});
