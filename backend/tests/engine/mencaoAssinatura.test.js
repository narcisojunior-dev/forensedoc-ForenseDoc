import { it, expect } from "vitest";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

it("preserva o CPF completo na transcrição da assinatura, mesmo com quebras de linha", () => {
  const e = heuristicExtractionFromText("Documento assinado eletronicamente por: PESSOA DE TESTE\nCPF n°: 123.456.789-09\nNúmero Único: protocolo-teste");
  expect(e.assinatura.mencao_textual).toBe("Documento assinado eletronicamente por: PESSOA DE TESTE CPF n°: 123.456.789-09");
});
