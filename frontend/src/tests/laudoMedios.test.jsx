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
    expect(lib.quesito).toMatch(/comprovante de transferência relativo ao crédito na conta 005555-1, agência 1234, Banco 237/);
    // O quesito pede o comprovante e a titularidade da conta; o valor do dossiê
    // não é afirmado, porque o laudo não examina as condições econômicas.
    expect(lib.quesito).not.toContain("R$ 1.779,15");
  });
});

describe("verificação de endereços na tela", () => {
  const comPares = {
    ...semDistancias,
    home: { query: "Rua X - Pedro II - PI", source: "Informado manualmente", geo: null, estado_confronto: "RECUSADO_CONFLITO", alerta: "CONFRONTO RECUSADO: conflito de UF." },
    confronto_enderecos: {
      pontos: { instrumento: { lat: -3.44, lon: -60.45, rotulo: "Manaquiri, AM, 69435-000", precisao: "municipio" }, laudo: { lat: -4.42, lon: -41.45 }, ip: { lat: -3.29, lon: -60.62 }, gps: { lat: -3.43, lon: -60.45 } },
      pares: [
        { id: "ip-x-instrumento", rotulo: "IP do dossiê × endereço do instrumento", papel: "instrumento", km: 73.4, texto: "73,4 km", indisponivel: null, precisao: "municipio" },
        { id: "laudo-x-instrumento", rotulo: "Endereço informado no laudo × endereço do instrumento", papel: "instrumento", km: 2153, texto: "2.153 km", indisponivel: null, precisao: "municipio" },
        { id: "ip-x-laudo", rotulo: "IP do dossiê × endereço informado no laudo", papel: "laudo", km: 2130, texto: "2.130 km", indisponivel: null, precisao: "ip" },
        { id: "gps-x-ip", rotulo: "GPS da assinatura × IP do dossiê", papel: "gps", km: 23.31, texto: "23,3 km", indisponivel: null, precisao: "ip" },
      ],
    },
    sumarioIrregularidades: {
      ...resultado.sumarioIrregularidades,
      geo: {
        modo: "pares",
        referencia: "pares",
        description: "Confronto de endereços, dois a dois.",
        items: [
          { label: "IP × instrumento", distance: 73.4, texto: "73,4 km", role: "instrumento", referencia: "par", par: "ip-x-instrumento" },
          { label: "Laudo × instrumento", distance: 2153, texto: "2.153 km", role: "instrumento", referencia: "par", par: "laudo-x-instrumento" },
          { label: "IP × laudo", distance: 2130, texto: "2.130 km", role: "laudo", referencia: "par", par: "ip-x-laudo" },
          { label: "GPS × IP", distance: 23.31, texto: "23,3 km", role: "gps", referencia: "par", par: "gps-x-ip" },
        ],
      },
    },
  };

  it("o § 3 lista os quatro pares e avisa a precisão de município", () => {
    const { container } = render(<LaudoForense report={montarRelatorio({ analysisId: "a1", result: comPares })} />);
    const texto = container.textContent;
    expect(texto).toContain("Verificação de endereços (confrontos dois a dois)");
    expect(texto).toContain("IP do dossiê × endereço do instrumento73,4 km");
    expect(texto).toContain("Endereço informado no laudo × endereço do instrumento2.153 km");
    expect(texto).toContain("IP do dossiê × endereço informado no laudo2.130 km");
    expect(texto).toContain("GPS da assinatura × IP do dossiê23,3 km");
    expect(texto).toMatch(/resolvido em nível de município \(Manaquiri, AM, 69435-000\)/);
  });

  it("o sumário desenha os quatro pares, com título e legenda próprios", () => {
    const report = montarRelatorio({ analysisId: "a1", result: comPares });
    const { container } = render(<LaudoForense report={report} />);
    const texto = container.textContent;
    expect(texto).toContain("VERIFICAÇÃO DE ENDEREÇOS: OS CONFRONTOS QUE IMPORTAM");
    expect(texto).toContain("com o endereço do instrumento");
    expect(texto).toContain("com o endereço do laudo");
    expect(report.sumarioIrregularidades.geo.items).toHaveLength(4);
    expect(container.querySelector(".summary-geo-chart")).not.toBeNull();
  });
});

