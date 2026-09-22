import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ordenarAchados, eixoDoAchado } from "../../src/engine/eixosAchado.js";
import { verificarCoerencia } from "../../src/engine/coerenciaLaudo.js";
import { buildIrregularitySummary } from "../../src/engine/irregularitySummary.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");

describe("ordenação por gravidade e eixo da tese", () => {
  it("dentro da mesma gravidade, crédito e biometria vêm antes de custódia e metadados", () => {
    const lista = [
      { codigo: "metadata-missing", gravidade: "ALTA" },
      { codigo: "INT1", gravidade: "ALTA" },
      { codigo: "BIO2", gravidade: "ALTA" },
      { codigo: "LIB1", gravidade: "ALTA" },
      { codigo: "SEG5", gravidade: "MÉDIA" },
    ];
    expect(ordenarAchados(lista).map((a) => a.codigo)).toEqual(["LIB1", "BIO2", "INT1", "metadata-missing", "SEG5"]);
  });

  it("código desconhecido vai para o fim do seu nível", () => {
    expect(eixoDoAchado("XYZ").eixo).toBe("outros");
  });

  it("no dossiê C6, os primeiros achados do sumário são prova do crédito, biometria e consentimento", async () => {
    const { texto } = JSON.parse(await readFile(CASO, "utf8"));
    const extracted = heuristicExtractionFromText(texto);
    // O BIO2 nasce do inventário de imagens do PDF, que o caso de texto não tem.
    extracted.achados_irregularidade.push({ codigo: "BIO2", gravidade: "ALTA", titulo: "Lastro biométrico frágil", texto: "fotografia única" });
    const sumario = buildIrregularitySummary({ reportId: "FD-T", extracted, hashes: {}, ipAnalysis: [] });
    expect(sumario.findings.slice(0, 3).map((f) => f.key)).toEqual(["LIB1", "BIO2", "INT1"]);
  });
});

describe("regras de coerência da Fase 4", () => {
  it("acusa ASS1 com bloco no instrumento, seguro sem bloco e BIO2 sem artefato", () => {
    const extracted = {
      contrato: { seguros: "R$ 218,64" },
      documentos_logicos: { documentos: [{ tipo: "INSTRUMENTO_PRINCIPAL", blocosAssinatura: [{ pagina: 6 }] }, { tipo: "SEGURO", blocosAssinatura: [] }] },
      achados_irregularidade: [{ codigo: "ASS1" }, { codigo: "BIO2" }],
      seguro_prestamista: null,
      imagem_biometrica: null,
    };
    expect(verificarCoerencia({}, extracted).map((v) => v.regra)).toEqual(
      expect.arrayContaining(["seguro-planilha-x-bloco", "ass1-x-bloco-no-instrumento", "biometria-achado-x-bloco"])
    );
  });
});
