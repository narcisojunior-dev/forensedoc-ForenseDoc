import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import resultado from "./fixtures/laudo-resultado.json";
import LaudoForense from "../laudo/LaudoForense.jsx";
import { montarRelatorio } from "../laudo/montarRelatorio.js";

/**
 * Ajustes médios da rodada 2 na tela: MED-01 (§ 5 com um único motivo),
 * MED-03 (IMG2 de template de análises antigas) e MED-05 (quesitos por achado).
 */
function comExtraido(alterar) {
  const extraido = JSON.parse(resultado.text);
  alterar(extraido);
  return { ...resultado, text: JSON.stringify(extraido) };
}

// Sem coordenada residencial, as distâncias são nulas (como o motor grava).
const semDistancias = {
  ...resultado,
  contractGeo: resultado.contractGeo ? { ...resultado.contractGeo, distance: null } : null,
  ipAnalysis: (resultado.ipAnalysis || []).map((ip) => ({ ...ip, distance: null })),
};

describe("MED-01: referência residencial recusada", () => {
  const recusado = {
    ...semDistancias,
    home: {
      query: "Rua Alcides Araújo Mourão, 945 - Pedro II - PI",
      source: "Informado manualmente",
      geo: null,
      estado_confronto: "RECUSADO_CONFLITO",
      conflito: { manual: { texto: "Rua Alcides Araújo Mourão, 945 - Pedro II - PI" } },
      alerta: "CONFRONTO RECUSADO: conflito entre endereço informado (PI) e endereço extraído do instrumento (AM).",
    },
  };

  it("negativos 4 e 5: sem \"Endereço adotado\" e sem nota de geocodificação", () => {
    const { container } = render(<LaudoForense report={montarRelatorio({ analysisId: "a1", result: recusado })} />);
    const texto = container.textContent;
    expect(texto).toContain("Endereço informado, não utilizado");
    expect(texto).not.toContain("Endereço adotado");
    expect(texto).not.toMatch(/Não foi possível geocodificar|tente novamente/);
    expect(texto.match(/CONFRONTO RECUSADO/g)).toHaveLength(1);
  });

  it("referência aceita continua como endereço adotado", () => {
    const aceito = { ...semDistancias, home: { query: "Rua A, Manaquiri - AM", source: "Informado manualmente", geo: null } };
    const { container } = render(<LaudoForense report={montarRelatorio({ analysisId: "a1", result: aceito })} />);
    expect(container.textContent).toContain("Endereço adotado");
  });
});

describe("MED-03: IMG2 de template gravado por versão anterior", () => {
  it("não aparece no § 4.2", () => {
    const r = comExtraido((e) => {
      e.imagens_pdf.achados = [{ codigo: "IMG2", severidade: "INFO", titulo: "Reuso de imagem de template", detalhe: "10 grupos repetidos parecem ser logotipo." }];
    });
    const { container } = render(<LaudoForense report={montarRelatorio({ analysisId: "a1", result: r })} />);
    expect(container.textContent).not.toContain("Reuso de imagem de template");
  });
});

describe("MED-05: quesitos por achado", () => {
  it("achado ALTA com modelo gera quesito próprio na tela", () => {
    const r = comExtraido((e) => {
      e.achados_irregularidade.push({ codigo: "LIB1", gravidade: "ALTA", titulo: "Ausência de comprovante de transferência", texto: "x" });
      e.contrato.valor_liberado = "R$ 1.779,15";
      e.liberacao_credito = { declarada: { banco: "237", agencia: "1234", conta: "005555-1" } };
    });
    const report = montarRelatorio({ analysisId: "a1", result: r });
    const lib = report.quesitos.find((q) => q.titulo === "Comprovação do Crédito Liberado");
    expect(lib.quesito).toMatch(/R\$ 1\.779,15 na conta 005555-1, agência 1234, Banco 237/);
  });
});
