import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, utimes, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { processMotorUploadPurge } from "../src/jobs/purgeMotorUploads.js";

/**
 * Arquivos transitórios do motor que um worker interrompido deixa para trás.
 * O dossiê da análise (que tem retenção própria, guiada pelo banco) não pode ser
 * tocado por esta varredura.
 */
let raiz;
const existe = (p) => access(p).then(() => true, () => false);
const envelhecer = (p) => utimes(p, new Date("2020-01-01"), new Date("2020-01-01"));

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "purge-motor-"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("processMotorUploadPurge", () => {
  it("remove o PDF do processo e os autos antigos, preserva o dossiê da análise", async () => {
    const dia = path.join(raiz, "tenant-1", "2020-01-01");
    await mkdir(path.join(dia, "replicas", "r1"), { recursive: true });
    const processo = path.join(dia, "a1-processo-abc123.pdf");
    const dossie = path.join(dia, "a1-abc123.pdf");
    const autos = path.join(dia, "replicas", "r1");
    await writeFile(processo, "x");
    await writeFile(dossie, "x");
    await writeFile(path.join(autos, "001.pdf"), "x");
    await Promise.all([envelhecer(processo), envelhecer(dossie), envelhecer(autos)]);

    const r = await processMotorUploadPurge(raiz);

    expect(r.removidos).toBe(2);
    expect(await existe(processo)).toBe(false);
    expect(await existe(autos)).toBe(false);
    expect(await existe(dossie)).toBe(true);
  });

  it("não toca em arquivo de job que ainda pode estar em andamento", async () => {
    const dia = path.join(raiz, "tenant-1", "2026-09-16");
    await mkdir(dia, { recursive: true });
    const processo = path.join(dia, "a1-processo-abc123.pdf");
    await writeFile(processo, "x");

    const r = await processMotorUploadPurge(raiz);

    expect(r.removidos).toBe(0);
    expect(await existe(processo)).toBe(true);
  });

  it("tolera raiz inexistente", async () => {
    expect(await processMotorUploadPurge(path.join(raiz, "nao-existe"))).toEqual({ removidos: 0 });
  });
});
