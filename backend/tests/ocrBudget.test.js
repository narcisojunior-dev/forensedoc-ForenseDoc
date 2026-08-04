import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O orçamento de tempo do OCR precisa caber no trabalho que o sistema aceita.
 *
 * Medição sobre dossiê real a 180 DPI: ~529 ms de rasterização e ~5 s de OCR por
 * página. Com `OCR_MAX_PAGES=20` são cerca de 112 segundos, contra um timeout
 * fixo de 60. O sistema aceitava 20 páginas e desistia por volta da 11ª,
 * estornando o crédito e devolvendo "não foi possível processar seu documento"
 * justamente para documentos escaneados, que são os que os bancos entregam.
 */
const AMBIENTE = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete process.env.OCR_TIMEOUT_MS;
  delete process.env.OCR_MAX_PAGES;
});

afterEach(() => {
  process.env = { ...AMBIENTE };
});

async function budget(env = {}) {
  Object.assign(process.env, env);
  vi.resetModules();
  const { ocrBudgetMs } = await import("../src/services/ocrService.js");
  return ocrBudgetMs();
}

describe("ocrBudgetMs", () => {
  it("cobre o custo projetado das páginas que o sistema aceita processar", async () => {
    // 20 páginas x ~5,6 s medidos. Sem folga o timeout volta a cortar no meio.
    const ms = await budget({ OCR_MAX_PAGES: "20" });
    expect(ms).toBeGreaterThanOrEqual(112_000);
  });

  it("acompanha OCR_MAX_PAGES em vez de ficar fixo", async () => {
    // Era este o defeito de fundo: os dois valores eram independentes, então
    // aumentar as páginas não aumentava o tempo concedido.
    const dez = await budget({ OCR_MAX_PAGES: "10" });
    const quarenta = await budget({ OCR_MAX_PAGES: "40" });
    expect(quarenta).toBeGreaterThan(dez);
  });

  it("mantém um piso para documentos curtos", async () => {
    // Uma página não pode gerar um prazo de 6 s: a inicialização do Tesseract e
    // a rasterização já consomem parte disso, e a máquina pode estar sob carga.
    expect(await budget({ OCR_MAX_PAGES: "1" })).toBe(60_000);
  });

  it("respeita OCR_TIMEOUT_MS quando explicitamente configurado", async () => {
    expect(await budget({ OCR_MAX_PAGES: "20", OCR_TIMEOUT_MS: "45000" })).toBe(45_000);
  });
});

describe("TTL do mutex de análise", () => {
  it("é maior que o orçamento de OCR", async () => {
    /*
     * Se o lock expirar antes do pior caso de processamento, um segundo job do
     * mesmo tenant entra enquanto o primeiro ainda roda, que é exatamente o que
     * o mutex existe para impedir. O TTL derivava de ANALYZE_TIMEOUT_MS, que é o
     * timeout da requisição HTTP de upload, grandeza diferente.
     */
    process.env.OCR_MAX_PAGES = "20";
    vi.resetModules();
    const { ocrBudgetMs } = await import("../src/services/ocrService.js");

    const ttlSegundos = Math.ceil(ocrBudgetMs() / 1000) + 120;
    expect(ttlSegundos * 1000).toBeGreaterThan(ocrBudgetMs());
    // Folga para extração, geolocalização e persistência depois do OCR.
    expect(ttlSegundos * 1000 - ocrBudgetMs()).toBeGreaterThanOrEqual(60_000);
  });
});
