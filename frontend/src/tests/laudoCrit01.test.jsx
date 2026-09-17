import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import resultado from "./fixtures/laudo-resultado.json";
import LaudoForense from "../laudo/LaudoForense.jsx";
import { montarRelatorio } from "../laudo/montarRelatorio.js";
import { verificarCoerenciaRenderizada } from "../laudo/exportarLaudoPdf.js";

/**
 * CRIT-01 da rodada 2: sumário persistido pelo motor anterior, com o confronto
 * de residência recusado, trazia "0,00 km" em selo favorável e no gráfico.
 */
function resultadoDaRodada2() {
  return {
    ...resultado,
    home: { query: "Rua Alcides Araújo Mourão, 945 - Pedro II - PI", source: "Informado manualmente", geo: null, estado_confronto: "RECUSADO_CONFLITO", alerta: "CONFRONTO RECUSADO: conflito entre endereço informado (PI) e endereço extraído do instrumento (AM)." },
    contractGeo: resultado.contractGeo ? { ...resultado.contractGeo, distance: null } : null,
    ipAnalysis: (resultado.ipAnalysis || []).map((ip) => ({ ...ip, distance: null })),
    sumarioIrregularidades: {
      ...resultado.sumarioIrregularidades,
      findings: [
        ...(resultado.sumarioIrregularidades?.findings || []),
        { severity: "FAVORÁVEL", key: "gps-near-home", title: "GPS da assinatura próximo à referência residencial.", text: "A coordenada da assinatura fica a 0,00 km do endereço de referência." },
      ],
      geo: { items: [{ label: "GPS · assinatura", distance: 0, role: "gps" }, { label: "TELEFÔNICA · rede", distance: null, role: "unknown" }], description: "Distâncias aproximadas até a referência residencial." },
      ipCards: [{ endereco: "2804::1", role: "unknown", badge: "REDE", text: "TELEFÔNICA BRASIL S.A, Manacapuru/Amazonas, 0,00 km da referência residencial.", geo: {} }],
    },
  };
}

describe("CRIT-01: laudo com referência recusada", () => {
  it("não imprime 0,00 km, selo de proximidade nem gráfico de distâncias", () => {
    const report = montarRelatorio({ analysisId: "a1", result: resultadoDaRodada2() });
    const { container } = render(<LaudoForense report={report} />);
    const texto = container.textContent;
    expect(texto).not.toMatch(/0,00 km/);
    expect(texto).not.toContain("GPS da assinatura próximo à referência residencial");
    // O quadro geográfico continua no laudo, sem ponto medido até a residência.
    expect(texto).toContain("GPS CONTRA IP: O CONFRONTO QUE IMPORTA");
    expect(report.sumarioIrregularidades.geo.items.every((i) => i.referencia === "gps")).toBe(true);
    expect(verificarCoerenciaRenderizada(container, { referenciaRecusada: true })).toEqual([]);
  });

  it("a checagem antes da exportação acusa o texto antigo", () => {
    const el = document.createElement("div");
    el.textContent = "GPS da assinatura próximo à referência residencial. A coordenada da assinatura fica a 0,00 km do endereço de referência.";
    expect(verificarCoerenciaRenderizada(el, { referenciaRecusada: true })).toHaveLength(2);
  });
});

describe("verificação geográfica independente da residência", () => {
  function recusadoComGpsEIp() {
    const r = resultadoDaRodada2();
    return {
      ...r,
      contractGeo: { lat: -3.4340189, lon: -60.4593232, distance: null, municipio: "Manaquiri", uf: "AM", fonte: "Texto extraído do PDF" },
      ipAnalysis: [{
        endereco: "2804::1",
        geo: { lat: -3.29972, lon: -60.62056, city: "Manacapuru", region: "Amazonas", isp: "TELEFÔNICA BRASIL S.A" },
        distance: null,
        distanceToSignature: 23.30954943753904,
        divergenciaAssinatura: { km: 23.30954943753904, tom: "ok", rotulo: "COMPATÍVEL", sintese: "A origem do IP fica dentro da margem esperada para geolocalização de operadora." },
      }],
    };
  }

  it("com a residência recusada, o laudo mantém o confronto GPS declarado x IP, com mapa e gráfico", () => {
    const report = montarRelatorio({ analysisId: "a1", result: recusadoComGpsEIp() });
    const { container } = render(<LaudoForense report={report} />);
    const texto = container.textContent;
    expect(texto).toContain("Confronto · geolocalização declarada no contrato × origem da conexão (IP)");
    expect(texto).toMatch(/23,31 km · COMPATÍVEL/);
    expect(texto).toContain("Município do local declaradoManaquiri/AM");
    expect(texto).toContain("Distância ao local declarado da assinatura");
    expect(container.querySelectorAll(".geo-visual-block").length).toBeGreaterThan(0);
    expect(report.sumarioIrregularidades.geo.items).toEqual([expect.objectContaining({ referencia: "gps", distance: 23.30954943753904 })]);
    expect(texto).toContain("Distância aproximada de cada IP até o GPS declarado da assinatura (Manaquiri/AM)");
    expect(texto).not.toMatch(/0,00 km|km da referência residencial/);
    expect(verificarCoerenciaRenderizada(container, { referenciaRecusada: true })).toEqual([]);
  });
});

