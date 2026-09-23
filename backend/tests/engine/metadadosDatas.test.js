import { describe, it, expect } from "vitest";
import { avaliarDatasDoArquivo, avisoAutorMetadados, instanteDe } from "../../src/engine/metadadosDatas.js";

describe("instanteDe", () => {
  it("lê a data formatada com fuso explícito", () => {
    expect(instanteDe("12/12/2024 11:06:39 UTC-03:00")).toBe(Date.UTC(2024, 11, 12, 14, 6, 39));
    expect(instanteDe("13/09/2023 13:37:55 UTC+00:00")).toBe(Date.UTC(2023, 8, 13, 13, 37, 55));
  });
  it("sem fuso, assume o informado", () => {
    expect(instanteDe("13/09/2023 10:37", 180)).toBe(Date.UTC(2023, 8, 13, 13, 37));
    expect(instanteDe("13/09/2023 10:37", 0)).toBe(Date.UTC(2023, 8, 13, 10, 37));
  });
});

describe("INT3: modificado antes de criado (dossiê C6, contrato 90140674306)", () => {
  const r = avaliarDatasDoArquivo({
    creationDate: "12/12/2024 11:06:39 UTC-03:00",
    modificationDate: "31/07/2024 14:31:12 UTC-03:00",
    creator: "Aspose.Words",
    producer: "openhtmltopdf.com",
    rotulosMsip: true,
  });
  it("emite INT3 como constatado, com âncora nos dois campos", () => {
    const int3 = r.achados.find((a) => a.codigo === "INT3");
    expect(int3).toBeTruthy();
    expect(int3.grau).toBe("CONSTATADO");
    expect(int3.texto).toMatch(/134 dias/);
    expect(int3.texto).toMatch(/Aspose\.Words/);
    expect(int3.ancora.trecho).toMatch(/CreationDate/);
  });
  it("reconhece a linhagem de template", () => {
    expect(r.linhagemTemplate).toBe(true);
  });
  it("rebaixa o aviso de autor para nota de rastreabilidade", () => {
    const aviso = avisoAutorMetadados({ author: "Edson Ferraz", clientName: "Maria de Loudes da Silva", linhagemTemplate: true, creator: "Aspose.Words", producer: "openhtmltopdf.com", rotulosMsip: true });
    expect(aviso).toMatch(/^Nota de rastreabilidade/);
    expect(aviso).toMatch(/template/);
    expect(aviso).not.toMatch(/difere/);
  });
  it("mantém o aviso antigo quando não há linhagem de template", () => {
    const aviso = avisoAutorMetadados({ author: "Fulano", clientName: "Beltrana", linhagemTemplate: false });
    expect(aviso).toMatch(/difere do nome do contratante/);
  });
});

describe("INT4: arquivo gerado no instante do aceite", () => {
  it("CCB Banco Master 27766845: criação 13:37:55 UTC e carimbo 10:37 sem fuso (Brasília)", () => {
    const r = avaliarDatasDoArquivo({
      creationDate: "13/09/2023 13:37:55 UTC+00:00",
      modificationDate: "13/09/2023 13:37:55 UTC+00:00",
      creator: null,
      producer: "dompdf 1.2.0 + CPDF",
      dataHoraAssinatura: "13/09/2023 10:37",
    });
    const int4 = r.achados.find((a) => a.codigo === "INT4");
    expect(int4).toBeTruthy();
    expect(int4.grau).toBe("CONSTATADO");
    expect(int4.texto).toMatch(/horário de Brasília/);
    expect(int4.texto).toMatch(/55 s/);
    expect(r.achados.some((a) => a.codigo === "INT3")).toBe(false);
  });
  it("dossiê C6: criação 11:06:39 UTC-03 e bloco de assinatura 11:06:39 sem fuso", () => {
    const r = avaliarDatasDoArquivo({
      creationDate: "12/12/2024 11:06:39 UTC-03:00",
      modificationDate: "12/12/2024 11:06:39 UTC-03:00",
      dataHoraAssinatura: "12/12/2024 11:06:39",
      eventos: [{ nome: "Coleta da Biometria Facial (assinatura eletrônica da CCB)", data_hora: "12/12/2024 11:06:39", fuso: "GMT" }],
      fusoTrilha: "GMT",
    });
    const int4 = r.achados.find((a) => a.codigo === "INT4");
    expect(int4).toBeTruthy();
    expect(int4.texto).toMatch(/no mesmo segundo/);
  });
  it("não dispara quando a criação é horas depois do aceite", () => {
    const r = avaliarDatasDoArquivo({
      creationDate: "12/12/2024 18:00:00 UTC-03:00",
      modificationDate: "12/12/2024 18:00:00 UTC-03:00",
      dataHoraAssinatura: "12/12/2024 11:06:39",
    });
    expect(r.achados).toHaveLength(0);
  });
});
