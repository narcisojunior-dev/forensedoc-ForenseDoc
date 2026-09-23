import { describe, it, expect } from "vitest";
import { analisarClausulasAdesao } from "../../src/engine/clausulasAdesao.js";

describe("analisarClausulasAdesao", () => {
  it("deve identificar cláusulas de fabricação probatória abusiva (ADE1)", () => {
    const textoComAbuso = `
      CÉDULA DE CRÉDITO BANCÁRIO
      Cláusula 12. O EMITENTE reconhece e concorda que a assinatura eletrônica por meio da aposição de clique
      ou aceite digital possui presunção absoluta de veracidade e eficácia de prova plena, declarando
      como prova plena os registros informatizados do banco e renunciando expressamente à via física.
    `;

    const res = analisarClausulasAdesao(textoComAbuso);
    expect(res.detectada).toBe(true);
    expect(res.achado).not.toBeNull();
    expect(res.achado.codigo).toBe("ADE1");
    expect(res.achado.gravidade).toBe("MÉDIA");
    expect(res.achado.grau).toBe("INDÍCIO");
    expect(res.achado.titulo).toMatch(/Cláusula de adesão com presunção unilateral de prova/);
    expect(res.achado.texto).toMatch(/art\. 51, VI, do CDC/);
  });

  it("não deve disparar em contrato regular sem cláusula abusiva", () => {
    const textoRegular = `
      CONTRATO DE EMPRÉSTIMO CONSIGNADO
      As partes elegem o foro da comarca do domicílio do emitente para dirimir eventuais litígios.
      O contratante autoriza o envio de comunicações operacionais para o telefone celular cadastrado.
    `;

    const res = analisarClausulasAdesao(textoRegular);
    expect(res.detectada).toBe(false);
    expect(res.achado).toBeNull();
  });
});
