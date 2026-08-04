import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Armazenamento do dossiê em disco local.
 *
 * Substituiu o Cloudflare R2 por decisão de proteção de dados: o arquivo contém
 * CPF, endereço e por vezes referência biométrica de terceiro, e mandá-lo para
 * fora do país configura transferência internacional sob a LGPD (art. 33).
 *
 * O que este módulo NÃO pode fazer, e é o que os testes prendem: sair da raiz de
 * armazenamento. As chaves vêm do banco, mas uma chave corrompida com `..`
 * transformaria leitura de dossiê em leitura de arquivo arbitrário do servidor, e
 * exclusão de dossiê em exclusão arbitrária.
 */
let raiz;
let mod;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "forensedoc-storage-"));
  process.env.UPLOAD_DIR = raiz;
  vi.resetModules();
  mod = await import("../src/services/objectStorageService.js");
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("buildKey", () => {
  it("prefixa por tenant, para exclusão em massa ser uma subárvore", () => {
    const k = mod.buildKey("tenant-1", "analise-9");
    expect(k.startsWith("tenant-1/")).toBe(true);
    expect(k.endsWith(".pdf")).toBe(true);
  });

  it("não inclui o nome do arquivo enviado", () => {
    // Nomes de dossiê trazem o nome do contratante e o número do contrato, e a
    // chave aparece em log e em métrica.
    const k = mod.buildKey("t1", "a1");
    expect(k).not.toMatch(/dossi|contrato|\.pdf\.pdf/i);
  });

  it("duas chamadas nunca colidem", () => {
    const a = mod.buildKey("t1", "a1");
    const b = mod.buildKey("t1", "a1");
    expect(a).not.toBe(b);
  });
});

describe("gravar, ler e apagar", () => {
  it("o ciclo completo devolve o conteúdo original", async () => {
    const conteudo = Buffer.from("%PDF-1.7 conteudo do dossie");
    const key = mod.buildKey("t1", "a1");

    expect(await mod.putPdf(key, conteudo)).toBe(key);
    expect((await mod.getPdf(key)).equals(conteudo)).toBe(true);

    await mod.deletePdf(key);
    expect(existsSync(path.join(raiz, key))).toBe(false);
  });

  it("cria a árvore de diretórios sozinho", async () => {
    const key = "tenant-x/2026-07-30/analise.pdf";
    await mod.putPdf(key, Buffer.from("x"));
    expect(existsSync(path.join(raiz, key))).toBe(true);
  });

  it("apagar arquivo inexistente é sucesso, não erro", async () => {
    // O objetivo é que ele não exista. Tratar ausência como falha faria a rotina
    // de expurgo reprocessar a mesma chave para sempre.
    await expect(mod.deletePdf("t1/2026-01-01/nao-existe.pdf")).resolves.toBeUndefined();
    expect(await mod.deletePdfs(["t1/2026-01-01/nao-existe.pdf"])).toBe(1);
  });

  it("apaga em lote e conta o que deixou de existir", async () => {
    const keys = [];
    for (let i = 0; i < 3; i++) {
      const k = mod.buildKey("t1", `a${i}`);
      await mod.putPdf(k, Buffer.from("x"));
      keys.push(k);
    }
    expect(await mod.deletePdfs(keys)).toBe(3);
    for (const k of keys) expect(existsSync(path.join(raiz, k))).toBe(false);
  });
});

describe("confinamento à raiz", () => {
  const fugas = [
    "../fora.pdf",
    "t1/../../fora.pdf",
    "t1/2026-01-01/../../../../etc/passwd",
  ];

  it("recusa leitura fora da raiz", async () => {
    for (const key of fugas) {
      await expect(mod.getPdf(key)).rejects.toThrow(/fora da raiz/);
    }
  });

  it("recusa exclusão fora da raiz", async () => {
    // O caso mais perigoso: exclusão arbitrária de arquivo do servidor.
    const alvo = path.join(path.dirname(raiz), "nao-apagar.txt");
    await writeFile(alvo, "importante");
    try {
      await mod.deletePdf(`../${path.basename(alvo)}`);
      expect(existsSync(alvo)).toBe(true);
    } finally {
      await rm(alvo, { force: true });
    }
  });

  it("recusa gravação fora da raiz, sem derrubar o fluxo", async () => {
    // Devolve null, que faz o chamador cair no payload em base64 em vez de
    // recusar a análise que o cliente pagou.
    expect(await mod.putPdf("../fora.pdf", Buffer.from("x"))).toBeNull();
  });
});

describe("retenção", () => {
  it("o padrão é 30 dias", () => {
    expect(mod.RETENCAO_DIAS).toBe(30);
  });
});

describe("ensureStorageReady", () => {
  it("cria a raiz e confirma que é gravável", async () => {
    const novo = path.join(raiz, "sub", "uploads");
    process.env.UPLOAD_DIR = novo;
    vi.resetModules();
    const m = await import("../src/services/objectStorageService.js");

    expect(await m.ensureStorageReady()).toBe(true);
    expect(existsSync(novo)).toBe(true);
  });

  it("devolve false quando não consegue usar o diretório", async () => {
    /*
     * Sem esta conferência no start, a falha só apareceria na primeira análise, e
     * como o sistema degrada para base64 em silêncio, ela apareceria como consumo
     * alto de memória do Redis em vez de erro de permissão.
     */
    const arquivo = path.join(raiz, "isto-e-um-arquivo");
    await writeFile(arquivo, "x");
    process.env.UPLOAD_DIR = path.join(arquivo, "uploads");
    vi.resetModules();
    const m = await import("../src/services/objectStorageService.js");

    expect(await m.ensureStorageReady()).toBe(false);
  });
});
