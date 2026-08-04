import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * A configuração é lida no carregamento do módulo, então cada caso precisa de
 * um import fresco. `vi.resetModules()` é o que torna isso possível sem
 * transformar as variáveis em leitura por chamada, que seria pior: a URL do
 * provedor não muda em tempo de execução, e ler o ambiente a cada consulta
 * esconderia erro de configuração até a primeira geocodificação.
 */
async function carregar(env) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("../src/services/nominatimClient.js");
}

const CHAVES = [
  "NOMINATIM_BASE_URL",
  "NOMINATIM_API_KEY",
  "NOMINATIM_KEY_PARAM",
  "NOMINATIM_USER_AGENT",
  "NODE_ENV",
];

let original;

beforeEach(() => {
  original = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("nominatimClient", () => {
  it("sem configuração, aponta para o serviço público", async () => {
    const { buildSearchUrl, usandoServicoPublico } = await carregar({
      NOMINATIM_BASE_URL: undefined,
      NOMINATIM_API_KEY: undefined,
    });
    const url = new URL(buildSearchUrl("Rua Solimões, Manaquiri"));
    expect(url.host).toBe("nominatim.openstreetmap.org");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.has("key")).toBe(false);
    expect(usandoServicoPublico()).toBe(true);
  });

  it("aponta para o provedor contratado e anexa a chave", async () => {
    const { buildSearchUrl, usandoServicoPublico } = await carregar({
      NOMINATIM_BASE_URL: "https://us1.locationiq.com/v1/",
      NOMINATIM_API_KEY: "pk.teste",
      NOMINATIM_KEY_PARAM: undefined,
    });
    const url = new URL(buildSearchUrl("Rua Solimões", { limit: 5, countrycodes: "br" }));
    expect(url.origin + url.pathname).toBe("https://us1.locationiq.com/v1/search");
    expect(url.searchParams.get("key")).toBe("pk.teste");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("countrycodes")).toBe("br");
    expect(usandoServicoPublico()).toBe(false);
  });

  it("respeita o nome do parâmetro de chave do provedor", async () => {
    const { buildSearchUrl } = await carregar({
      NOMINATIM_BASE_URL: "https://api.geocode.earth/v1",
      NOMINATIM_API_KEY: "ge-teste",
      NOMINATIM_KEY_PARAM: "api_key",
    });
    const url = new URL(buildSearchUrl("Manaquiri"));
    expect(url.searchParams.get("api_key")).toBe("ge-teste");
    expect(url.searchParams.has("key")).toBe(false);
  });

  it("escapa a consulta em vez de concatenar", async () => {
    const { buildSearchUrl } = await carregar({ NOMINATIM_BASE_URL: undefined });
    const url = buildSearchUrl("Rua A & B, nº 10");
    expect(url).toContain("Rua+A+%26+B");
    expect(url).not.toContain("& B");
  });

  it("avisa no boot quando produção usa o serviço público", async () => {
    const { avisarSeServicoPublico } = await carregar({
      NODE_ENV: "production",
      NOMINATIM_BASE_URL: undefined,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(avisarSeServicoPublico()).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("não avisa quando o provedor contratado está configurado", async () => {
    const { avisarSeServicoPublico } = await carregar({
      NODE_ENV: "production",
      NOMINATIM_BASE_URL: "https://us1.locationiq.com/v1",
      NOMINATIM_API_KEY: "pk.teste",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(avisarSeServicoPublico()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
