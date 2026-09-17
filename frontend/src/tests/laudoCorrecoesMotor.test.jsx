import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import resultado from "./fixtures/laudo-resultado.json";
import LaudoForense from "../laudo/LaudoForense.jsx";
import { montarRelatorio } from "../laudo/montarRelatorio.js";
import { validateRenderableReport } from "../laudo/exportarLaudoPdf.js";

/**
 * Apresentação das correções do relatório de homologação (dossiê C6): referência
 * residencial recusada, produto CLT, protocolo que não é hash, procedência
 * processual e campos vazios no instrumento.
 */

function comAjustes() {
  const extracted = JSON.parse(resultado.text);
  extracted.contrato = { ...extracted.contrato, produto_codigo: "CONSIGNADO_CLT", produto: "Crédito consignado do trabalhador (CLT)" };
  extracted.assinatura = {
    ...extracted.assinatura,
    hash_documento_assinado: null,
    hash_declarado_estado: "AUSENTE",
    codigo_autenticacao_declarado: "3b9e2c1a-7d4f-4e8a-9c21-5f6d7e8a9b0c",
    codigo_autenticacao_origem: 'rótulo "Número único", pág. 2',
    codigo_autenticacao_estado: "DECLARADO_NAO_CONFERIVEL",
  };
  extracted.cliente = {
    ...extracted.cliente,
    estados_campos: {
      rg: { estado: "LOCALIZADO_SUSPEITO", valor: "111111111111", motivo: "dígitos repetidos" },
      endereco: { estado: "LOCALIZADO_VAZIO", valor: "Nao Informado, SD" },
    },
  };
  const alerta = "CONFRONTO RECUSADO: conflito entre endereço informado (PI) e endereço extraído do instrumento (AM). Nenhuma distância é calculada.";
  return montarRelatorio({
    analysisId: "a1",
    result: {
      ...resultado,
      text: JSON.stringify(extracted),
      home: { query: "Pedro II - PI", source: "Informado manualmente", geo: null, estado_confronto: "RECUSADO_CONFLITO", alerta },
      contractGeo: resultado.contractGeo ? { ...resultado.contractGeo, distance: null } : null,
      ipAnalysis: (resultado.ipAnalysis || []).map((ip) => ({ ...ip, distance: null })),
      metadata: {
        ...resultado.metadata,
        digitalSignature: {
          ...(resultado.metadata?.digitalSignature || {}),
          procedencia: { procedencia: "EXPORTACAO_SISTEMA_PROCESSUAL", sistema: "PROJUDI", tribunal: "TJAM", juntado_por: "Carlos Eduardo Nunes", movimento: "1.6", data_juntada: "28/10/2025" },
        },
      },
    },
  });
}

describe("laudo com as correções do motor", () => {
  const report = comAjustes();
  const texto = () => render(<LaudoForense report={report} />).container.textContent;

  it("sem referência residencial válida, o quesito geográfico não é montado", () => {
    expect(report.quesitos.map((q) => q.titulo)).not.toContain("Esclarecimento sobre a Divergência Geográfica");
    expect(report.quesitos.map((q) => q.numero)).toEqual([1, 2, 3, 4]);
  });

  it("imprime o estado do confronto recusado", () => {
    expect(texto()).toContain("CONFRONTO RECUSADO: conflito entre endereço informado (PI)");
  });

  it("consignado CLT não cita normas do INSS", () => {
    const t = texto();
    expect(t).toContain("Crédito consignado do trabalhador (CLT)");
    expect(t).not.toContain("Lei 8.213/1991");
  });

  it("protocolo aparece como código de autenticação, e não como hash", () => {
    const t = texto();
    expect(t).toContain("Código de autenticação declarado (não é hash)");
    expect(t).not.toContain("Confronto · hash informado × hash encontrado");
  });

  it("procedência processual, campo suspeito e campo vazio são nomeados", () => {
    const t = texto();
    expect(t).toContain("Exportação de sistema processual (PROJUDI/TJAM)");
    expect(t).toContain("Carlos Eduardo Nunes");
    expect(t).toContain("111111111111 (suspeito: dígitos repetidos)");
    expect(t).toContain('Localizado e vazio no instrumento: "Nao Informado, SD"');
  });

  it("inventário de imagens: corpo só com as relevantes, detalhe no Anexo II", () => {
    const extracted = JSON.parse(resultado.text);
    extracted.imagens_pdf = {
      disponivel: true,
      total: 3,
      imagens: [
        { page: 1, num: 1, type: "image", width: 360, height: 640, classificacao: "fotografia/biometria provável", biometricaProvavel: true, size: "38.4K", sha256: "A".repeat(64) },
        { page: 2, num: 2, type: "smask", width: 2, height: 2, classificacao: "máscara alfa", size: "12B", sha256: "B".repeat(64) },
        { page: 3, num: 3, type: "image", width: 242, height: 64, classificacao: "logotipo/template", size: "7440B", sha256: "C".repeat(64) },
      ],
      grupos_repetidos: [],
      achados: [],
    };
    const r = montarRelatorio({ analysisId: "a1", result: { ...resultado, text: JSON.stringify(extracted) } });
    const { container } = render(<LaudoForense report={r} />);
    expect(container.textContent).toContain("2 imagens de template, sem relevância para a perícia");
    expect(container.textContent).toContain("Anexo II · Inventário técnico de imagens");
    expect(() => validateRenderableReport(container)).not.toThrow();
  });

  it("continua passando na higiene de texto exigida antes da exportação", () => {
    const { container } = render(<LaudoForense report={report} />);
    expect(() => validateRenderableReport(container)).not.toThrow();
  });
});
