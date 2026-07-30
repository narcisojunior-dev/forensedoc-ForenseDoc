import { describe, it, expect } from "vitest";
import { buildCustodyChain, ELEMENTOS_CADEIA } from "../src/reports/custodyChain.js";
import { classifyIpDivergence, describeIpDivergence } from "../src/utils/geoDivergence.js";

/**
 * § 4.1 do laudo. Antes eram oito selos "PRESENTE / AUSENTE": o laudo concluía
 * que a cadeia estava incompleta sem dizer o que cada elemento comprova, qual
 * norma o exige ou que efeito a ausência produz.
 */
describe("buildCustodyChain", () => {
  const completo = {
    assinatura: {
      titular_certificado: "IRAILZO SEIXAS PINTO",
      data_hora_assinatura: "25/06/2025 10:45:03",
      metodos_autenticacao: ["E-mail", "SMS"],
      hash_documento_assinado: "a".repeat(64),
      tipo: "Assinatura eletrônica avançada",
    },
    cadeia_custodia: { trilha_auditoria: true, evidencia_aceite: true },
    cliente: { nome: "Irailzo Seixas Pinto" },
  };

  it("reconhece cadeia completa quando todos os elementos existem", () => {
    const c = buildCustodyChain(completo, [{ endereco: "189.4.22.10" }], true);
    expect(c.presentes).toBe(8);
    expect(c.avaliacao.rotulo).toBe("SUBSTANCIALMENTE COMPLETA");
    expect(c.avaliacao.pct).toBe(100);
    expect(c.faltantes).toEqual([]);
  });

  it("um IP geolocalizado supre o elemento de registro de IP", () => {
    // O campo declarado pode não existir, mas se o § 6 extraiu um IP, o registro
    // está materialmente presente no documento.
    const semCampo = { ...completo, cadeia_custodia: { trilha_auditoria: true } };
    const comIp = buildCustodyChain(semCampo, [{ endereco: "189.4.22.10" }], true);
    const semIp = buildCustodyChain(semCampo, [], true);

    expect(comIp.elementos.find((e) => e.chave === "registro_ip").presente).toBe(true);
    expect(semIp.elementos.find((e) => e.chave === "registro_ip").presente).toBe(false);
  });

  it("classifica como incompleta quando falta o essencial", () => {
    const c = buildCustodyChain({}, [], false);
    expect(c.presentes).toBe(0);
    expect(c.avaliacao.rotulo).toBe("INCOMPLETA");
    expect(c.avaliacao.tom).toBe("danger");
    // A leitura precisa apontar a consequência processual, não só o placar.
    expect(c.avaliacao.leitura).toMatch(/Tema 1\.061/);
  });

  it("percorre as quatro faixas de completude", () => {
    const faixas = [
      [8, "SUBSTANCIALMENTE COMPLETA"],
      [6, "PARCIAL"],
      [4, "FRÁGIL"],
      [2, "INCOMPLETA"],
    ];
    for (const [presentes, rotulo] of faixas) {
      // Monta um `cadeia_custodia` com exatamente N elementos verdadeiros.
      const cc = {};
      for (const e of ELEMENTOS_CADEIA.slice(0, presentes)) cc[e.chave] = true;
      const c = buildCustodyChain({ cadeia_custodia: cc }, [], false);
      expect(c.presentes, `${presentes} elementos`).toBe(presentes);
      expect(c.avaliacao.rotulo, `${presentes} elementos`).toBe(rotulo);
    }
  });

  it("cada elemento traz função probatória, norma e efeito da ausência", () => {
    // É o que diferencia o laudo de uma lista de selos.
    for (const e of buildCustodyChain({}, [], false).elementos) {
      expect(e.comprova.length, e.nome).toBeGreaterThan(40);
      expect(e.norma.length, e.nome).toBeGreaterThan(10);
      expect(e.ausencia.length, e.nome).toBeGreaterThan(40);
    }
  });

  it("cita o Marco Civil no elemento de registro de IP", () => {
    // É a norma que fixa os prazos de guarda — e a perda do dado é irreversível.
    const ip = ELEMENTOS_CADEIA.find((e) => e.chave === "registro_ip");
    expect(ip.norma).toMatch(/12\.965/);
    expect(ip.ausencia).toMatch(/irrevers/i);
  });
});

/**
 * Classificação da divergência geográfica. A régua é larga de propósito:
 * geolocalização por IP aponta o ponto de presença da operadora, não o
 * aparelho, e em rede móvel brasileira erra por dezenas de quilômetros.
 */
describe("classifyIpDivergence", () => {
  it("trata distância curta como compatível", () => {
    expect(classifyIpDivergence(5).nivel).toBe("compativel");
    expect(classifyIpDivergence(59).nivel).toBe("compativel");
  });

  it("escala pelas quatro faixas", () => {
    expect(classifyIpDivergence(100).nivel).toBe("atencao");
    expect(classifyIpDivergence(274).nivel).toBe("relevante");
    expect(classifyIpDivergence(1500).nivel).toBe("grave");
  });

  it("é nulo quando não há distância a classificar", () => {
    for (const v of [null, undefined, NaN, Infinity]) {
      expect(classifyIpDivergence(v)).toBeNull();
    }
  });

  it("nenhuma faixa afirma fraude", () => {
    // O laudo é preliminar; afirmar fraude a partir de distância seria concluir
    // além do que o dado sustenta.
    for (const km of [5, 100, 274, 1500]) {
      const c = classifyIpDivergence(km);
      expect(c.sintese).not.toMatch(/\bfraude\b/i);
      expect(c.sintese).not.toMatch(/comprova(?!r)/i);
    }
  });
});

describe("describeIpDivergence", () => {
  it("registra a força do confronto quando a referência é confirmada", () => {
    const r = describeIpDivergence({ km: 274, referenciaConfirmada: true });
    expect(r.ressalva).toMatch(/confirmada pelo operador/i);
  });

  it("adverte sobre imprecisão somada quando a referência é geocodificada", () => {
    const r = describeIpDivergence({
      km: 274,
      referenciaConfirmada: false,
      referenciaRotulo: "Extraído do contrato",
    });
    expect(r.ressalva).toMatch(/geocodifica/i);
    expect(r.ressalva).toContain("Extraído do contrato");
  });

  it("preserva a distância para o laudo imprimir", () => {
    expect(describeIpDivergence({ km: 274.004, referenciaConfirmada: true }).km).toBeCloseTo(274.004);
  });
});
