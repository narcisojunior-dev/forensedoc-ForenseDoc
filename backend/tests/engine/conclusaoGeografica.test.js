import { describe, it, expect } from "vitest";
import { buildIrregularitySummary } from "../../src/engine/irregularitySummary.js";

/**
 * D2 · a conclusão geográfica contradizia o corpo do próprio laudo.
 *
 * A pág. 22 do laudo FD-20260917 afirmou "ausência integral de trilha de
 * rede/localização" onze páginas depois de o § 4.3 listar seis eventos, quatro
 * com IP completo e três com coordenada, e de o § 6 dedicar uma seção inteira
 * a um IPv6 com porta, titular do bloco, provedor e fuso.
 *
 * A frase era o valor inicial da variável de síntese, não um ramo: sobrevivia
 * sempre que nenhum ramo disparasse. Com a residência recusada não há
 * distância, e se nenhum IP for de infraestrutura, nada sobrescreve o default.
 */

const REGEX_AUSENCIA = /aus[êe]ncia integral/i;

const base = {
  extracted: {
    contrato: {},
    cliente: {},
    assinatura: {},
  },
};

describe("D2 · ausência integral só com as duas contagens em zero", () => {
  it("com IP de acesso e sem distância calculada, não afirma ausência integral", () => {
    const sumario = buildIrregularitySummary({
      ...base,
      home: { estado_confronto: "RECUSADO_CONFLITO" },
      ipAnalysis: [{ endereco: "2804:18:6881:4f33:e868:6941:39ee:81fc", geo: { city: "Manacapuru", isp: "TELEFÔNICA" } }],
      contractGeo: { lat: -3.4340189, lon: -60.4593232, municipio: "Manaquiri", uf: "AM" },
    });
    expect(sumario.synthesis).not.toMatch(REGEX_AUSENCIA);
  });

  it("a síntese distingue confronto não concluído de insumo ausente", () => {
    const sumario = buildIrregularitySummary({
      ...base,
      home: { estado_confronto: "RECUSADO_CONFLITO" },
      ipAnalysis: [{ endereco: "189.45.2.10", geo: { city: "Manacapuru" } }],
      contractGeo: { lat: -3.43, lon: -60.45 },
    });
    expect(sumario.synthesis).toMatch(/n[ãa]o foi conclu[ií]do/i);
    expect(sumario.synthesis).toMatch(/1 endereço IP inventariado/);
    expect(sumario.synthesis).toMatch(/estados distintos/i);
  });

  it("as contagens saem como número, e eventos não se misturam com IPs inventariados", () => {
    const sumario = buildIrregularitySummary({
      ...base,
      home: { estado_confronto: "RECUSADO_CONFLITO" },
      ipAnalysis: [{ endereco: "189.45.2.10", geo: {} }, { endereco: "10.0.0.1", geo: {} }],
      contractGeo: { lat: -3.43, lon: -60.45 },
    });
    expect(sumario.geo.insumos).toEqual({
      eventos_com_ip: 0,
      eventos_com_coordenada: 0,
      ips_inventariados: 2,
      coordenada_declarada: true,
    });
  });

  it("conta eventos da trilha separadamente dos IPs inventariados", () => {
    const sumario = buildIrregularitySummary({
      ...base,
      extracted: {
        ...base.extracted,
        trilha_eventos: {
          eventos: [
            { nome: "Acesso", ip: null, lat: null, lon: null },
            { nome: "Aceite CCB", ip: "189.45.2.10", lat: -3.43, lon: -60.45 },
            { nome: "Biometria", ip: "189.45.2.11", lat: -3.44, lon: -60.46 },
          ],
        },
      },
      ipAnalysis: [{ endereco: "189.45.2.10", geo: { lat: -3.4, lon: -60.4 } }],
      contractGeo: { lat: -3.43, lon: -60.45 },
    });
    expect(sumario.geo.insumos.eventos_com_ip).toBe(2);
    expect(sumario.geo.insumos.eventos_com_coordenada).toBe(2);
    expect(sumario.geo.insumos.ips_inventariados).toBe(1);
    // As mesmas contagens saem no placar, não só no bloco geográfico.
    expect(sumario.counts.eventos_com_ip).toBe(2);
    expect(sumario.counts.eventos_com_coordenada).toBe(2);
    expect(sumario.counts.ips_inventariados).toBe(1);
  });

  /** Latitude 0 é coordenada válida; latitude sem longitude não localiza nada. */
  it("aceita coordenada zero e recusa par incompleto", () => {
    const comZero = buildIrregularitySummary({
      ...base,
      extracted: { ...base.extracted, trilha_eventos: { eventos: [{ nome: "Aceite", lat: 0, lon: 0 }] } },
      ipAnalysis: [],
      contractGeo: null,
    });
    expect(comZero.geo.insumos.eventos_com_coordenada).toBe(1);

    const meiaCoordenada = buildIrregularitySummary({
      ...base,
      extracted: { ...base.extracted, trilha_eventos: { eventos: [{ nome: "Aceite", lat: -3.43, lon: null }] } },
      ipAnalysis: [],
      contractGeo: null,
    });
    expect(meiaCoordenada.geo.insumos.eventos_com_coordenada).toBe(0);
  });

  /** O motivo é consultado, não presumido. */
  it("não atribui à referência quando a causa é outra", () => {
    const semGeoDeIp = buildIrregularitySummary({
      ...base,
      home: { estado_confronto: "DISPONIVEL" },
      ipAnalysis: [{ endereco: "189.45.2.10", geo: {} }],
      contractGeo: { lat: -3.43, lon: -60.45 },
    });
    expect(semGeoDeIp.synthesis).toMatch(/n[ãa]o foram geolocalizados/i);
    expect(semGeoDeIp.synthesis).not.toMatch(/refer[êe]ncia residencial/i);
  });

  it("sem IP e coordenada, a conclusão se limita à extração", () => {
    const sumario = buildIrregularitySummary({ ...base, ipAnalysis: [], contractGeo: null });
    expect(sumario.synthesis).not.toMatch(REGEX_AUSENCIA);
    expect(sumario.synthesis).toMatch(/extração disponível/i);
    expect(sumario.geo.insumos).toEqual({
      eventos_com_ip: 0,
      eventos_com_coordenada: 0,
      ips_inventariados: 0,
      coordenada_declarada: false,
    });
  });

  it("com coordenada e sem IP, ainda não é ausência integral", () => {
    const sumario = buildIrregularitySummary({
      ...base,
      ipAnalysis: [],
      contractGeo: { lat: -3.43, lon: -60.45 },
    });
    expect(sumario.synthesis).not.toMatch(REGEX_AUSENCIA);
  });
});
