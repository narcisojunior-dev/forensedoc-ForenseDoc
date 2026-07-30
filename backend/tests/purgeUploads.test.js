import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A retenção do PDF original é política de proteção de dados, não faxina.
 *
 * O que precisa ser garantido: o arquivo vencido some, o LAUDO permanece (com os
 * hashes que sustentam a integridade), e a eliminação deixa registro datado.
 * Sob a LGPD não basta ter apagado; é preciso poder comprovar quando e o quê.
 */
const analises = { findMany: vi.fn(), updateMany: vi.fn() };
const armazenamento = {
  deletePdfs: vi.fn(),
  RETENCAO_DIAS: 90,
  isConfigured: vi.fn(() => true),
};

vi.mock("../src/utils/prisma.js", () => ({ prisma: { analysis: analises } }));
vi.mock("../src/services/objectStorageService.js", () => armazenamento);

const { processUploadPurge } = await import("../src/jobs/purgeUploads.js");

const vencida = (id) => ({ id, pdfObjectKey: `uploads/t1/2026-01-01/${id}.pdf` });

beforeEach(() => {
  // `clearAllMocks` limpa as chamadas mas NÃO a fila de `mockResolvedValueOnce`,
  // então valores enfileirados por um teste vazavam para o seguinte.
  vi.resetAllMocks();
  armazenamento.isConfigured.mockReturnValue(true);
  analises.findMany.mockResolvedValue([]);
  analises.updateMany.mockResolvedValue({ count: 0 });
  armazenamento.deletePdfs.mockImplementation(async (ks) => ks.length);
});

describe("processUploadPurge", () => {
  it("apaga os vencidos e marca a data da eliminação", async () => {
    analises.findMany.mockResolvedValueOnce([vencida("a"), vencida("b")]).mockResolvedValueOnce([]);

    const r = await processUploadPurge();

    expect(r.removidos).toBe(2);
    expect(armazenamento.deletePdfs).toHaveBeenCalledWith([
      "uploads/t1/2026-01-01/a.pdf",
      "uploads/t1/2026-01-01/b.pdf",
    ]);
    const dados = analises.updateMany.mock.calls[0][0].data;
    expect(dados.pdfPurgedAt).toBeInstanceOf(Date);
    expect(dados.pdfObjectKey).toBeNull();
  });

  it("seleciona pela janela de retenção, e só o que ainda não foi expurgado", async () => {
    analises.findMany.mockResolvedValue([]);
    await processUploadPurge();

    const where = analises.findMany.mock.calls[0][0].where;
    expect(where.pdfPurgedAt).toBeNull();
    expect(where.pdfObjectKey).toEqual({ not: null });

    const limite = where.createdAt.lt;
    const diasAtras = (Date.now() - limite.getTime()) / (24 * 3600 * 1000);
    expect(Math.round(diasAtras)).toBe(90);
  });

  it("NÃO toca no laudo: a integridade sobrevive ao original", async () => {
    /*
     * É essa separação que permite reter o PDF por pouco tempo sem enfraquecer a
     * prova. O `result` guarda SHA-256 e SHA-1 do arquivo analisado.
     */
    analises.findMany.mockResolvedValueOnce([vencida("a")]).mockResolvedValueOnce([]);
    await processUploadPurge();

    const dados = analises.updateMany.mock.calls[0][0].data;
    expect(dados).not.toHaveProperty("result");
    expect(Object.keys(dados).sort()).toEqual(["pdfObjectKey", "pdfPurgedAt"]);
  });

  it("marca o lote mesmo com falha individual, para não repetir para sempre", async () => {
    // Uma chave que já não existe no bucket falharia em toda execução, e a
    // rotina a reprocessaria indefinidamente.
    analises.findMany.mockResolvedValueOnce([vencida("a"), vencida("b")]).mockResolvedValueOnce([]);
    armazenamento.deletePdfs.mockResolvedValue(1);

    await processUploadPurge();

    expect(analises.updateMany.mock.calls[0][0].where.id.in).toEqual(["a", "b"]);
  });

  it("processa em lotes até esvaziar", async () => {
    const lote = Array.from({ length: 500 }, (_, i) => vencida(`x${i}`));
    analises.findMany.mockResolvedValueOnce(lote).mockResolvedValueOnce([vencida("y")]);

    const r = await processUploadPurge();

    expect(analises.findMany).toHaveBeenCalledTimes(2);
    expect(r.removidos).toBe(501);
  });

  it("não faz nada sem armazenamento configurado", async () => {
    armazenamento.isConfigured.mockReturnValue(false);
    expect(await processUploadPurge()).toEqual({ removidos: 0 });
    expect(analises.findMany).not.toHaveBeenCalled();
  });

  it("nada vencido não gera escrita no banco", async () => {
    analises.findMany.mockResolvedValue([]);
    await processUploadPurge();
    expect(analises.updateMany).not.toHaveBeenCalled();
  });
});
