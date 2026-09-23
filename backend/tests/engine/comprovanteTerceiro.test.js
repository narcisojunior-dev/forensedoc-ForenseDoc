import { describe, it, expect } from "vitest";
import { segmentarDocumentos } from "../../src/engine/documentosLogicos.js";
import { avaliarComprovanteCredito } from "../../src/engine/comprovanteCredito.js";

const paginas = (...conteudos) => conteudos.join("\f");
const flat = "LIBERAÇÃO DO CRÉDITO: Crédito em Conta Banco: 237 - Ag: 1234 - Conta: 005555-1";
const contrato = { valor_liberado: "R$ 1.000,00" };

describe("LIB3: crédito em favor de pessoa diversa do contratante", () => {
  it("emite LIB3 como constatado quando o documento do destinatário difere do contratante", () => {
    const texto = paginas(
      "CÉDULA DE CRÉDITO BANCÁRIO\n" + flat,
      "COMPROVANTE DE TRANSFERÊNCIA\nFavorecido: OUTRA PESSOA\nCPF: 111.222.333-44\nValor transferido: R$ 1.000,00\nID da transação E2E123"
    );
    const r = avaliarComprovanteCredito({ texto, flat, segmentacao: segmentarDocumentos(texto), contrato, cliente: { cpf: "999.888.777-66" } });
    const lib3 = r.achados.find((a) => a.codigo === "LIB3");
    expect(lib3).toBeTruthy();
    expect(lib3).toMatchObject({ gravidade: "ALTA", grau: "CONSTATADO" });
    expect(lib3.ancora.pagina).toBe(2);
    // Valor confere e conta não foi lida: não há LIB2 por cima do LIB3.
    expect(r.achados.some((a) => a.codigo === "LIB2")).toBe(false);
  });

  it("não emite LIB3 quando o documento é o do contratante", () => {
    const texto = paginas(
      "CÉDULA DE CRÉDITO BANCÁRIO\n" + flat,
      "COMPROVANTE DE TRANSFERÊNCIA\nFavorecido: A PRÓPRIA\nCPF: 999.888.777-66\nValor transferido: R$ 1.000,00\nID da transação E2E123"
    );
    const r = avaliarComprovanteCredito({ texto, flat, segmentacao: segmentarDocumentos(texto), contrato, cliente: { cpf: "99988877766" } });
    expect(r.achados.map((a) => a.codigo)).toEqual([]);
  });

  it("LIB2 continua para divergência de valor, agora com grau e âncora", () => {
    const texto = paginas(
      "CÉDULA DE CRÉDITO BANCÁRIO\n" + flat,
      "COMPROVANTE DE TRANSFERÊNCIA\nFavorecido: FULANO\nValor transferido: R$ 900,00\nID da transação E2E123"
    );
    const r = avaliarComprovanteCredito({ texto, flat, segmentacao: segmentarDocumentos(texto), contrato, cliente: {} });
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0]).toMatchObject({ codigo: "LIB2", grau: "CONSTATADO" });
    expect(r.achados[0].ancora.pagina).toBe(2);
  });
});
