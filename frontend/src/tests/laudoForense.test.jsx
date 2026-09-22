import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import resultado from "./fixtures/laudo-resultado.json";
import LaudoForense from "../laudo/LaudoForense.jsx";
import { montarRelatorio } from "../laudo/montarRelatorio.js";
import { validateRenderableReport } from "../laudo/exportarLaudoPdf.js";

/**
 * Laudo do motor de geração, alimentado pelo resultado persistido do SaaS.
 * A fixture é gerada pelo backend sobre um PDF sintético (sem dado real).
 */
const report = montarRelatorio({ analysisId: "a1", result: resultado });

describe("montarRelatorio", () => {
  it("converte o resultado persistido no formato do laudo do motor", () => {
    expect(report.reportId).toBe("FD-20260916-AAAAAAAAAA");
    expect(report.file.sizeKB).toMatch(/^\d+\.\d{2}$/);
    expect(report.extracted.contrato.numero).toBe("1234567890");
    // Confronto concluído entra no § 7 com o veredito no lugar do estado do job.
    expect(report.processComparison.status).toBe("DIVERGÊNCIAS A CONFERIR");
    expect(report.quesitos).toHaveLength(5);
  });

  it("deixa o confronto fora do laudo enquanto processa", () => {
    const r = montarRelatorio({ analysisId: "a1", result: { ...resultado, processComparison: { status: "PROCESSING" } } });
    expect(r.processComparison).toBeNull();
  });
});

describe("LaudoForense", () => {
  // Renderiza a cada teste: o cleanup do setup desmonta o DOM entre os casos.
  const montar = () => {
    const { container } = render(<LaudoForense report={report} />);
    return { container, texto: container.textContent };
  };

  it("renderiza todas as seções do laudo do motor, na numeração dele", () => {
    const { texto } = montar();
    for (const titulo of [
      "§ 1 · Identificação e integridade criptográfica",
      "§ 1.1 · Verificação dos metadados internos do PDF",
      "§ 2 · Dados do instrumento contratual",
      "§ 3 · Qualificação do contratante",
      "§ 4 · Assinatura eletrônica e cadeia de custódia",
      "§ 4.1 · Auditoria da assinatura e do trilho de acesso",
      "§ 4.2 · Imagens, selfie e prova de vida",
      "§ 5 · Geolocalização da assinatura · confronto geográfico",
      "§ 6 · Endereços IP e geolocalização (1 encontrado(s))",
      "§ 7 · Confronto com informações do processo",
      "§ 8 · Achados técnicos e diligências",
      "§ 9 · Observações periciais complementares",
      "§ 10 · Fundamentação normativa aplicável",
    ]) {
      expect(texto).toContain(titulo);
    }
    expect(texto).toContain("Irregularidades do laudo ForenseDoc, em síntese");
  });

  /*
   * O laudo verifica cadeia de custódia. Valor, taxa, CET e prazo saíram do
   * documento, e com eles os achados, as verificações e as diligências que só
   * existiam pelo exame econômico.
   */
  it("não publica as condições econômicas da operação", () => {
    const { texto } = montar();
    expect(texto).toContain("As condições econômicas da operação");
    for (const proibido of [
      "R$ 5.000,00",
      "2,10%",
      "CET mensal",
      "Aferição matemática",
      "Somatório das parcelas",
      "Valor da parcela",
      "Taxa de juros mensal",
    ]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("tira do sumário os achados, as verificações e as diligências de eixo financeiro", () => {
    const { texto } = montar();
    for (const proibido of [
      "Demonstrativo de cálculo do CET ausente do instrumento",
      "Instrumento sem os números essenciais do negócio",
      "Demonstrativo de cálculo do CET",
    ]) {
      expect(texto, proibido).not.toContain(proibido);
    }
    // A diligência do instrumento completo continua, sem os itens econômicos.
    expect(texto).toContain("Instrumento contratual completo");
    expect(texto).not.toContain("campo de valor liberado ao cliente");
  });

  it("identifica o laudo pelo ForenseDoc, sem escritório nem OAB", () => {
    const { texto } = montar();
    expect(texto).toContain("FORENSEDOC");
    expect(texto).not.toContain("Ronney");
    expect(texto).not.toContain("OAB/PI");
  });

  it("mantém os acréscimos do SaaS", () => {
    const { texto } = montar();
    expect(texto).toContain("Campos conferidos pelo operador");
    expect(texto).toContain("Anexo I · Sugestão de quesitos ao juízo e ao perito");
    expect(texto).toContain("Titular do bloco (RDAP)");
    expect(texto).toContain("calculados pelo servidor");
  });

  it("desenha mapas com blocos da API do SaaS", () => {
    const { container } = montar();
    const blocos = container.querySelectorAll("img.geo-map-tile");
    expect(blocos.length).toBeGreaterThan(0);
    expect(blocos[0].getAttribute("src")).toMatch(/^\/api\/map-tile\/\d+\/\d+\/\d+\.png$/);
  });

  it("passa na higiene de texto exigida antes da exportação em PDF", () => {
    const { container } = montar();
    const el = container.querySelector("#fd-report");
    // jsdom não calcula innerText; a higiene usa o texto do elemento.
    Object.defineProperty(el, "innerText", { value: el.textContent });
    expect(() => validateRenderableReport(el)).not.toThrow();
  });

  it("não usa a aparência do laudo fora do escopo .fd-root", () => {
    const { container } = montar();
    expect(container.firstChild.classList.contains("fd-root")).toBe(true);
  });
});
