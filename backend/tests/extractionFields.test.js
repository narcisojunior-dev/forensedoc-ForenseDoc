import { describe, it, expect } from "vitest";
import { heuristicExtractionFromText } from "../src/services/extractionService.js";

/**
 * Dois defeitos encontrados num contrato real, ambos do tipo mais perigoso deste
 * sistema: não produziam campo vazio, produziam AFIRMAÇÃO ERRADA.
 */

describe("nome do contratante", () => {
  it("não captura o rótulo do formulário como se fosse o nome", () => {
    /*
     * O padrão anterior usava `/i` junto de uma classe de caixa alta, o que anula
     * a classe. No cabeçalho de tabela "Nome do cliente CPF ...", o motor
     * retrocedia, tratava "do cliente" como valor e "CPF" como delimitador. O
     * laudo saía com o contratante chamado "Do Cliente".
     */
    const texto = "Assinatura do cliente Geolocalizacao Data e hora Nome do cliente CPF ID da sessao";
    // Sem valor no documento, o correto é null. O defeito devolvia "Do Cliente".
    expect(heuristicExtractionFromText(texto).cliente.nome).toBeNull();
  });

  it("captura o nome quando ele vem depois do rótulo", () => {
    const r = heuristicExtractionFromText("Nome LUCILENE FRANCA ABREU CPF 036.112.833-98");
    expect(r.cliente.nome).toBe("Lucilene Franca Abreu");
  });

  it("captura mesmo com o rótulo completo antes do valor", () => {
    const r = heuristicExtractionFromText("Nome do cliente LUCILENE FRANCA ABREU CPF 036.112.833-98");
    expect(r.cliente.nome).toBe("Lucilene Franca Abreu");
  });

  it("acha o nome verdadeiro mesmo quando o cabeçalho aparece ANTES", () => {
    // É a ordem do documento real: a tabela declara as colunas e só depois
    // preenche os valores.
    const texto =
      "Nome do cliente CPF ID da sessao usuario " +
      "Nome LUCILENE FRANCA ABREU CPF 036.112.833-98";
    expect(heuristicExtractionFromText(texto).cliente.nome).toBe("Lucilene Franca Abreu");
  });

  it("NÃO captura o nome da mãe como contratante", () => {
    // Está no mesmo contrato. Capturá-lo poria outra pessoa como parte do negócio.
    const r = heuristicExtractionFromText("Nome da mae LUCIA FRANCA ABREU CPF 111.222.333-44");
    expect(r.cliente.nome ?? "").not.toMatch(/lucia/i);
  });

  it("exige nome com mais de uma palavra", () => {
    expect(heuristicExtractionFromText("Contratante TITULAR CPF 000").cliente.nome).toBeNull();
  });

  it("aceita nome em Title Case, não só em caixa alta", () => {
    /*
     * Regressão da PRIMEIRA correção. Exigir caixa alta de verdade resolveu o
     * "Do Cliente", e passou a rejeitar "Francisco Chaves Da Silva", que é como
     * outro banco escreve. Trocar falso positivo por falso negativo não é
     * corrigir: o laudo saía sem contratante nenhum.
     */
    const r = heuristicExtractionFromText("Nome do cliente: Francisco Chaves Da Silva CPF: 01768926301");
    expect(r.cliente.nome).toBe("Francisco Chaves Da Silva");
  });

  it("para no campo seguinte em vez de engolir o rótulo", () => {
    // "CPF" é sigla em caixa alta e casaria como palavra de nome. A exclusão
    // precisa barrar a PALAVRA, não descartar o conjunto por contê-la.
    const r = heuristicExtractionFromText("Nome do cliente: Maria Souza CPF: 123 Endereco: RUA X");
    expect(r.cliente.nome).toBe("Maria Souza");
  });

  it("NÃO captura o nome do consultor do banco", () => {
    // Está no dossiê de trilha, e é o vendedor, não o contratante.
    const r = heuristicExtractionFromText("Nome do consultor: LAECIO JUNIOR DE SOUSA Latitude: -4.17");
    expect(r.cliente.nome ?? "").not.toMatch(/laecio/i);
  });

  it("conectivo minúsculo no meio do nome é preservado", () => {
    const r = heuristicExtractionFromText("Nome: Jose da Silva dos Santos CPF: 000");
    expect(r.cliente.nome).toBe("Jose Da Silva Dos Santos");
  });
});

describe("geolocalização declarada", () => {
  it("aceita coordenada com três casas decimais", () => {
    /*
     * O padrão exigia 4 ou mais casas nos DOIS números. O contrato registrava
     * "-7.115, -34.86306" quatro vezes, e a latitude tem três casas: nenhuma foi
     * extraída, e o laudo AFIRMOU que não havia geolocalização declarada.
     *
     * Contar casas decimais mede formatação, não plausibilidade.
     */
    const r = heuristicExtractionFromText("Geolocalizacao -7.115, -34.86306 Data e hora");
    expect(r.geolocalizacao_assinatura.presente).toBe(true);
    expect(r.geolocalizacao_assinatura.latitude).toBe("-7.115");
    expect(r.geolocalizacao_assinatura.longitude).toBe("-34.86306");
  });

  it("aceita vírgula como separador decimal", () => {
    const r = heuristicExtractionFromText("Coordenadas -7,115; -34,86306");
    expect(r.geolocalizacao_assinatura.presente).toBe(true);
  });

  it("recusa par de números fora do território brasileiro", () => {
    // O critério que substituiu a contagem de casas: plausibilidade geográfica.
    // Um par arbitrário do documento não cai nas duas faixas ao mesmo tempo.
    const r = heuristicExtractionFromText("Valores 45.678 , 89.012 na tabela");
    expect(r.geolocalizacao_assinatura.presente).toBe(false);
  });

  it("recusa longitude positiva, que não existe no Brasil", () => {
    const r = heuristicExtractionFromText("Referencia -7.115, 34.86306 fim");
    expect(r.geolocalizacao_assinatura.presente).toBe(false);
  });

  it("continua preferindo o par rotulado como latitude e longitude", () => {
    // Regressão da correção anterior: rótulo combinado tem precedência sobre
    // qualquer par solto que apareça antes no texto.
    const texto = "Tabela 12.345, 67.890 Latitude e Longitude: -3,434452 / -60,4725532";
    const g = heuristicExtractionFromText(texto).geolocalizacao_assinatura;
    expect(g.latitude).toBe("-3.434452");
    expect(g.longitude).toBe("-60.4725532");
  });
});
