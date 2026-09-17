import { describe, it, expect } from "vitest";
import { avaliarAnaliseAfetada } from "../src/services/varreduraLaudos.js";

describe("varredura retroativa de laudos", () => {
  it("reconhece o laudo antigo do dossiê C6", () => {
    const extraido = {
      contrato: { datas_nota: "O primeiro vencimento extraído é anterior à data do contrato" },
      cliente: { estado: "AM" },
      assinatura: { hash_documento_assinado: "f0a12fcc-9113-47bd-8d06-663fa404fb6a" },
      afericao_matematica: { cet_implicito_mensal_numero: 0.2, composicao_confere: false, cet_anual_confere: false, carencia_dias: -27 },
      achados_irregularidade: [{ codigo: "CAD2" }],
    };
    const result = {
      text: JSON.stringify(extraido),
      home: { source: "Informado manualmente", geo: { matchedUf: "PI" } },
      metadata: { digitalSignature: { procedencia: { procedencia: "REIMPRESSAO_POSTERIOR_PROVAVEL" } } },
    };
    expect(avaliarAnaliseAfetada(result).map((c) => c.id)).toEqual([
      "cet-implicito-no-teto", "data-contrato-suspeita", "referencia-manual-outra-uf", "composicao-sem-seguro",
      "anualizacao-12-meses", "protocolo-como-hash", "beneficio-inss-sem-classificacao", "reimpressao-atribuida-ao-banco",
    ]);
  });

  it("laudo gerado pelo motor corrigido não é marcado", () => {
    const extraido = {
      contrato: { produto_codigo: "CONSIGNADO_CLT" },
      cliente: { estado: "AM" },
      assinatura: { hash_documento_assinado: null },
      afericao_matematica: { cet_implicito_mensal_numero: 0.075894, composicao_confere: true, composicao_componentes: [], cet_anual_confere: true, cet_anual_convencao: "365 dias", carencia_dias: 98 },
      metadados_processuais: null,
      achados_irregularidade: [],
    };
    const result = { text: JSON.stringify(extraido), home: { source: "Informado manualmente", estado_confronto: "RECUSADO_CONFLITO", geo: null } };
    expect(avaliarAnaliseAfetada(result)).toEqual([]);
  });

  it("reconhece o laudo da rodada 2 com 0,00 km em selo favorável", () => {
    const result = {
      text: JSON.stringify({ contrato: { produto_codigo: "CONSIGNADO_CLT" }, afericao_matematica: { composicao_componentes: [], cet_anual_convencao: "365 dias" } }),
      home: { estado_confronto: "RECUSADO_CONFLITO", geo: null },
      contractGeo: { distance: null },
      ipAnalysis: [{ distance: null }],
      sumarioIrregularidades: { favorable: [{ key: "gps-near-home", text: "a 0,00 km do endereço de referência" }] },
    };
    expect(avaliarAnaliseAfetada(result).map((c) => c.id)).toEqual(["distancia-zero-sem-confronto"]);
  });

  it("resultado ilegível não quebra a varredura", () => {
    expect(avaliarAnaliseAfetada({ text: "{quebrado" })).toEqual([]);
    expect(avaliarAnaliseAfetada(null)).toEqual([]);
  });
});
