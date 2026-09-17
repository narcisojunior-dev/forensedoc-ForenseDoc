import { describe, it, expect } from "vitest";
import { segmentarDocumentos, avaliarAssinaturaPorDocumento } from "../../src/engine/documentosLogicos.js";
import { avaliarComprovanteCredito } from "../../src/engine/comprovanteCredito.js";
import { analisarTrilhaEventos, extrairEventosTrilha } from "../../src/engine/trilhaEventos.js";
import { analisarBiometria } from "../../src/engine/biometria.js";
import { valorAbaixoDoRotulo } from "../../src/engine/colunas.js";

const paginas = (...conteudos) => conteudos.join("\f");

describe("documentos lógicos e ASS1", () => {
  it("emite ASS1 quando só o documento acessório tem bloco de assinatura", () => {
    const texto = paginas(
      "CÉDULA DE CRÉDITO BANCÁRIO Nº 1\nCláusulas",
      "VIA NÃO NEGOCIÁVEL\nmais cláusulas sem assinatura",
      "Proposta de Adesão\nSeguro Prestamista\nAssinatura do Proponente\nDocumento assinado eletronicamente por: FULANO DE TAL"
    );
    const r = avaliarAssinaturaPorDocumento(segmentarDocumentos(texto));
    expect(r.achado).toMatchObject({ codigo: "ASS1", gravidade: "ALTA" });
    expect(r.achado.texto).toMatch(/págs\. 1 a 2/);
  });

  it("não emite ASS1 com segmentação pouco confiável (um só título)", () => {
    const texto = paginas("CÉDULA DE CRÉDITO BANCÁRIO", "texto solto\nDocumento assinado eletronicamente por: FULANO DE TAL");
    expect(avaliarAssinaturaPorDocumento(segmentarDocumentos(texto)).achado).toBeNull();
  });

  it("texto sem quebra de página não é segmentado", () => {
    expect(segmentarDocumentos("CÉDULA DE CRÉDITO BANCÁRIO sem páginas")).toBeNull();
  });
});

describe("comprovante de crédito", () => {
  const contrato = { valor_liberado: "R$ 1.000,00" };
  const flat = "LIBERAÇÃO DO CRÉDITO: Crédito em Conta Banco: 237 - Ag: 1234 - Conta: 005555-1";

  it("localiza comprovante fora das cláusulas e confere o valor", () => {
    const texto = paginas("CÉDULA DE CRÉDITO BANCÁRIO\n" + flat, "COMPROVANTE DE TRANSFERÊNCIA\nFavorecido: FULANO\nValor transferido: R$ 900,00\nID da transação E2E123");
    const r = avaliarComprovanteCredito({ texto, flat, segmentacao: segmentarDocumentos(texto), contrato, cliente: {} });
    expect(r.comprovante).toMatchObject({ pagina: 2, valor: "R$ 900,00" });
    expect(r.achados.map((a) => a.codigo)).toEqual(["LIB2"]);
  });

  it("marcadores dentro dos termos de uso não contam como comprovante", () => {
    const texto = paginas("CÉDULA DE CRÉDITO BANCÁRIO\n" + flat, "TERMOS DE USO\nfavorecido: você. remetente: nós. comprovante de transferência será enviado");
    const r = avaliarComprovanteCredito({ texto, flat, segmentacao: segmentarDocumentos(texto), contrato, cliente: {} });
    expect(r.achados.map((a) => a.codigo)).toEqual(["LIB1"]);
  });

  it("sem liberação declarada não há achado", () => {
    expect(avaliarComprovanteCredito({ texto: "nada", flat: "nada", segmentacao: null }).achados).toEqual([]);
  });
});

describe("trilha de eventos", () => {
  const trilha = [
    "Acesso",
    "Hora UTC, Data: 01/02/2025 12:00:00",
    "Latitude e Longitude: -5.0000 / -42.0000",
    "Aceite da CCB",
    "Hora UTC, Data: 01/02/2025 12:20:00",
    "Latitude e Longitude: -10.0000 / -48.0000",
    "Aceite da CCB",
    "Hora UTC, Data: 01/02/2025 12:30:00",
  ].join("\n");

  it("detecta evento repetido e salto geográfico, sem acusar jornada curta acima de 10 minutos", () => {
    const r = analisarTrilhaEventos({ texto: trilha, segmentacao: null, ufEmissao: "PI", dataHoraAssinatura: null, flat: trilha });
    const codigos = r.achados.map((a) => a.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["TRL4", "TRL5"]));
    expect(codigos).not.toContain("TRL2");
    expect(r.eventos[0].hora_local).toBe("01/02/2025 09:00:00");
  });

  it("menos de dois eventos não é trilha", () => {
    expect(analisarTrilhaEventos({ texto: "Acesso\nHora GMT, Data: 01/02/2025 12:00:00", segmentacao: null })).toBeNull();
    expect(extrairEventosTrilha("Data e hora: 25/06/2025 10:45:03")).toEqual([]);
  });
});

describe("biometria", () => {
  const imagem = (extra) => ({ biometricaProvavel: true, page: 1, num: 1, width: 1200, height: 1600, megapixels: 1.92, exif: true, formato: "JPEG", ...extra });

  it("com EXIF, resolução boa e processo descrito, não há achado", () => {
    const r = analisarBiometria({
      imagens: { imagens: [imagem(), imagem({ num: 2 }), { classificacao: "imagem documental", pixels: 400000 }] },
      flat: "prova de vida com score de similaridade, limiar de 90, base Serpro, fornecedor biometria Unico Check",
      alegaBiometria: true,
    });
    expect(r.achado).toBeNull();
  });

  it("sem imagem facial não há bloco", () => {
    expect(analisarBiometria({ imagens: { imagens: [] }, flat: "", alegaBiometria: true })).toBeNull();
  });
});

describe("colunas", () => {
  it("lê o valor abaixo do rótulo pela posição", () => {
    const texto = "  Nº da Proposta      Prêmio à vista R$\n  123456              99,90\n";
    expect(valorAbaixoDoRotulo(texto, /Pr[êe]mio/)).toBe("99,90");
    expect(valorAbaixoDoRotulo(texto, /Proposta/)).toBe("123456");
  });
});
