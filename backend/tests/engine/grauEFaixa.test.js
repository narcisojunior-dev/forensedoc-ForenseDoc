import { describe, it, expect } from "vitest";
import { classificarGrauProcessual, GRAUS } from "../../src/engine/grausConclusao.js";
import * as frontend from "../../../frontend/src/laudo/grausConclusao.js";
import { classificarFaixaIp } from "../../src/utils/ipFaixa.js";

describe("grau dos achados novos no catálogo unificado (grausConclusao)", () => {
  it("constatados no arquivo", () => {
    for (const codigo of ["INT3", "INT4", "LIB3", "IMG6", "ip-infraestrutura", "TRL4", "TRL5", "hash-mismatch", "gps-ip-conflict", "divergencia-endereco-cadastral"]) {
      expect(classificarGrauProcessual(codigo)).toBe(GRAUS.CONSTATADO);
    }
  });
  it("não verificáveis pelo arquivo", () => {
    for (const codigo of ["DEV3", "TRL3", "hash-missing", "simple-signature", "device-gap", "metadata-missing", "IMG0", "LIB1"]) {
      expect(classificarGrauProcessual(codigo)).toBe(GRAUS.NAO_VERIFICAVEL);
    }
  });
  it("indícios", () => {
    for (const codigo of ["DEV2", "TRL2", "FAT1", "metadata-author", "IMG4"]) {
      expect(classificarGrauProcessual(codigo)).toBe(GRAUS.INDICIO);
    }
  });
  it("a cópia do frontend decide igual", () => {
    for (const codigo of ["INT3", "DEV2", "DEV3", "hash-missing", "ip-infraestrutura", "TRL1", "BIO2", "ELA2"]) {
      expect(frontend.classificarGrauProcessual(codigo)).toBe(classificarGrauProcessual(codigo));
    }
    expect(frontend.GRAUS).toEqual(GRAUS);
  });
});

describe("faixa do IP pelo titular do bloco", () => {
  it("provedor regional de Teresina (bloco da trilha do dossiê C6)", () => {
    const f = classificarFaixaIp({ owner: "MJ TELECOMUNICACOES LTDA", asn: "AS264997" });
    expect(f.tipo).toBe("provedor_regional");
    expect(f.alerta).toBe(false);
  });
  it("operadora móvel", () => {
    expect(classificarFaixaIp({ isp: "Claro NXT Telecomunicacoes S.A." }).tipo).toBe("operadora");
  });
  it("hospedagem e VPN disparam alerta", () => {
    expect(classificarFaixaIp({ isp: "Amazon Technologies Inc." })).toMatchObject({ tipo: "hospedagem", alerta: true });
    expect(classificarFaixaIp({ owner: "NordVPN S.A." })).toMatchObject({ tipo: "vpn", alerta: true });
  });
  it("sem nome, não classifica", () => {
    expect(classificarFaixaIp({})).toMatchObject({ tipo: "desconhecida", alerta: false });
  });
});

describe("placar de graus depois dos cortes do sumário", () => {
  it("conta o que sobrou na projeção, não a lista gravada", async () => {
    const { sanearSumario } = await import("../../src/reports/laudoApresentacao.js");
    const achado = (key, severity, grau) => ({ key, severity, grau, title: key, text: "x" });
    const sumario = {
      graus: { total: 4, constatados: 1, naoVerificaveis: 1, indicios: 2 },
      findings: [achado("CAD4", "MÉDIA", GRAUS.CONSTATADO), achado("LIB1", "ALTA", GRAUS.NAO_VERIFICAVEL), achado("FIN3", "INFO", GRAUS.INDICIO), achado("gps-home-distance", "INFO", GRAUS.INDICIO)],
      allFindings: [achado("CAD4", "MÉDIA", GRAUS.CONSTATADO), achado("LIB1", "ALTA", GRAUS.NAO_VERIFICAVEL), achado("FIN3", "INFO", GRAUS.INDICIO), achado("gps-home-distance", "INFO", GRAUS.INDICIO)],
      favorable: [],
      checks: [],
      diligences: [],
      geo: { items: [] },
    };
    // Residência recusada: sai o achado de distância; eixo financeiro sai sempre.
    const s = sanearSumario(sumario, { estado_confronto: "RECUSADO_CONFLITO" }, [], null);
    expect(s.graus).toEqual({ total: 2, constatados: 1, naoVerificaveis: 1, indicios: 0 });
  });
});

describe("quesito 2 só com divergência do § 5", () => {
  it("IP compatível a 23 km não gera quesito de divergência geográfica", async () => {
    const { generateJudicialQuesitos } = await import("../../src/reports/quesitosTemplate.js");
    const base = { clienteNome: "Fulano", banco: "Banco X", cidadeDomicilio: "Manaquiri, AM", distanciaKm: "23.1", cidadeIp: "Manacapuru / Amazonas", ip: "2804::1", achados: [], extracted: {} };
    const titulos = (q) => q.map((x) => x.titulo);
    expect(titulos(generateJudicialQuesitos({ ...base, divergenciaIp: "compativel" }))).not.toContain("Esclarecimento sobre a Divergência Geográfica");
    expect(titulos(generateJudicialQuesitos({ ...base, divergenciaIp: "grave" }))).toContain("Esclarecimento sobre a Divergência Geográfica");
    // Sem o nível informado (análises antigas), a regra anterior continua valendo.
    expect(titulos(generateJudicialQuesitos(base))).toContain("Esclarecimento sobre a Divergência Geográfica");
  });
});
