import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { medirPele, pareceIlustracao, CLASSE_ILUSTRACAO } from "../../src/engine/aparenciaFoto.js";
import { valorEhRotulo } from "../../src/engine/salvaguardas.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

async function jpegChapado(r, g, b, w = 379, h = 240) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
}

describe("aparência da imagem: pele contra ilustração", () => {
  it("cartão vermelho chapado (arte Credcesta) não é fotografia de pessoa", async () => {
    const medida = await medirPele(await jpegChapado(226, 30, 45));
    expect(medida.disponivel).toBe(true);
    expect(medida.fracaoPele).toBe(0);
    expect(pareceIlustracao(medida)).toBe(true);
  });
  it("imagem em tom de pele passa como fotografia", async () => {
    const medida = await medirPele(await jpegChapado(210, 160, 130, 360, 640));
    expect(medida.fracaoPele).toBeGreaterThan(0.9);
    expect(pareceIlustracao(medida)).toBe(false);
  });
  it("bytes que não são imagem não derrubam a classificação", async () => {
    const medida = await medirPele(Buffer.from("isto não é um jpeg"));
    expect(medida.disponivel).toBe(false);
    expect(pareceIlustracao(medida)).toBe(false);
  });
  it("classe da ilustração conta como template", () => {
    expect(/template/.test(CLASSE_ILUSTRACAO)).toBe(true);
  });
});

describe("rótulos de formulário lidos como valor", () => {
  it("sequência de rótulos com dois-pontos é rótulo", () => {
    for (const v of ["Cidade: Estado:", "Estado:", "Bairro: Cidade: Estado: CEP:", "Cidade", "Endereço Residencial:"]) {
      expect(valorEhRotulo(v), v).toBe(true);
    }
  });
  it("valor de verdade não é rótulo", () => {
    for (const v of ["Amparo", "Jardim Juliana", "SP", "", null]) {
      expect(valorEhRotulo(v), String(v)).toBe(false);
    }
  });
});

describe("cidade e UF do cliente na CCB do Banco Master", () => {
  const texto = `CÉDULA DE CRÉDITO BANCÁRIO ("CCB") CONTRATAÇÃO DE SAQUE MEDIANTE TRANSFERÊNCIA
DE RECURSOS DO CARTÃO CONSIGNADO DE BENEFÍCIO CREDCESTA EMITIDO PELO BANCO MASTER S.A.
CCB nº: 27766845
QUADRO 1 - CREDOR
BANCO MASTER S.A., com sede na cidade do Rio de Janeiro, Estado do Rio de Janeiro, na Praia de
Botafogo, n.º 228, 17º andar, sala 1.702, Botafogo, CEP: 22250-906, inscrito no CNPJ/ME sob o n.º
33.923.798/0001-00 por meio de sua filial situada na Capital do Estado de São Paulo, na Avenida
Brigadeiro Faria Lima, n.º 3.477, 5º andar, Torre B, Itaim Bibi, CEP 04538-133 ("BANCO MASTER").
QUADRO 2 - DADOS PESSOAIS DO(A) CLIENTE (EMITENTE/ADERENTE)
Nome do Cliente:
EUNICE COELHO FERREIRA
CPF:
039.697.948-38
RG:
21202001
Data de Nascimento:
02/04/1962
Endereço Residencial:
Rua Attílio Cilotti
Nº
20
Complemento:
Bairro:
Jardim Juliana
Cidade:
Amparo
Estado:
SP
CEP:
13905-390
Telefone/Celular:
(19) 99904-2614
`;
  it("cidade é Amparo e não a sede do credor", () => {
    const e = heuristicExtractionFromText(texto);
    expect(e.cliente.cidade).toBe("Amparo");
    expect(e.cliente.estado).toBe("SP");
    expect(e.cliente.bairro).toBe("Jardim Juliana");
  });
  it("com os rótulos em colunas, nenhum rótulo vira valor", () => {
    const colunas = texto.replace("Bairro:\nJardim Juliana\nCidade:\nAmparo\nEstado:\nSP\nCEP:\n13905-390", "Bairro:            Cidade:        Estado:   CEP:\nJardim Juliana     Amparo         SP        13905-390");
    const e = heuristicExtractionFromText(colunas);
    expect(e.cliente.bairro).not.toMatch(/cidade|estado/i);
    expect(e.cliente.cidade).not.toMatch(/rio de janeiro|estado/i);
    expect(e.cliente.estado).not.toBe("do");
  });
});
