import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Retenção das tabelas que cresciam sem parar.
 *
 * `audit_logs` guarda endereço IP e user-agent, que são dado pessoal sob a LGPD.
 * Mantê-los para sempre é o mesmo problema que motivou a política de 90 dias no
 * PDF original, e passou despercebido porque a atenção estava no upload.
 */
const auditLog = { deleteMany: vi.fn() };
const notification = { deleteMany: vi.fn() };
vi.mock("../src/utils/prisma.js", () => ({ prisma: { auditLog, notification } }));

async function carregar(env = {}) {
  vi.resetModules();
  Object.assign(process.env, env);
  return import("../src/jobs/purgeRecords.js");
}

const AMBIENTE = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...AMBIENTE };
  delete process.env.AUDIT_RETENTION_DAYS;
  delete process.env.NOTIFICATION_RETENTION_DAYS;
  auditLog.deleteMany.mockResolvedValue({ count: 0 });
  notification.deleteMany.mockResolvedValue({ count: 0 });
});

const diasDe = (chamada) =>
  Math.round((Date.now() - chamada.where.createdAt.lt.getTime()) / (24 * 3600 * 1000));

describe("processRecordPurge", () => {
  it("usa 12 meses para auditoria e 6 para notificação", async () => {
    const { processRecordPurge } = await carregar();
    await processRecordPurge();
    expect(diasDe(auditLog.deleteMany.mock.calls[0][0])).toBe(365);
    expect(diasDe(notification.deleteMany.mock.calls[0][0])).toBe(180);
  });

  it("apaga SOMENTE notificações já lidas", async () => {
    // Apagar uma não lida esconderia do usuário um aviso que ele nunca viu.
    const { processRecordPurge } = await carregar();
    await processRecordPurge();
    expect(notification.deleteMany.mock.calls[0][0].where.read).toBe(true);
  });

  it("não deixa configuração descumprir o piso do Marco Civil", async () => {
    /*
     * Art. 15: seis meses de registros de acesso a aplicação é obrigação legal.
     * Uma variável de ambiente não pode reduzir isso por conveniência, e o
     * desvio precisa ficar visível em vez de ser silenciosamente aceito.
     */
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { processRecordPurge } = await carregar({ AUDIT_RETENTION_DAYS: "30" });
    await processRecordPurge();

    expect(diasDe(auditLog.deleteMany.mock.calls[0][0])).toBe(180);
    expect(aviso.mock.calls[0][0]).toMatch(/Marco Civil/);
    aviso.mockRestore();
  });

  it("prazo maior que o piso é respeitado", async () => {
    const { processRecordPurge } = await carregar({ AUDIT_RETENTION_DAYS: "730" });
    await processRecordPurge();
    expect(diasDe(auditLog.deleteMany.mock.calls[0][0])).toBe(730);
  });

  it("apaga em lotes até esgotar", async () => {
    // `deleteMany` sem limite numa tabela grande trava a linha por muito tempo e
    // pode estourar o WAL.
    auditLog.deleteMany
      .mockResolvedValueOnce({ count: 1000 })
      .mockResolvedValueOnce({ count: 1000 })
      .mockResolvedValueOnce({ count: 7 });
    const { processRecordPurge } = await carregar();
    const r = await processRecordPurge();

    expect(auditLog.deleteMany).toHaveBeenCalledTimes(3);
    expect(r.auditoria).toBe(2007);
    expect(auditLog.deleteMany.mock.calls[0][0].limit).toBe(1000);
  });
});
