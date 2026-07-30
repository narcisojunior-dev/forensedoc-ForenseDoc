import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * O cache das consultas externas não é otimização: é o que separa o sistema de
 * bater nas cotas gratuitas e, no caso do Nominatim, de violar a política de uso
 * (que bloqueia por IP do servidor).
 *
 * Duas propriedades precisam ser garantidas, e a segunda é a mais importante:
 * o cache acerta na repetição, e uma falha do Redis NUNCA impede o laudo.
 */
const loja = new Map();

const redisFalso = {
  get: vi.fn(async (k) => (loja.has(k) ? loja.get(k) : null)),
  setex: vi.fn(async (k, _ttl, v) => loja.set(k, v)),
};

vi.mock("../src/utils/redis.js", () => ({ redis: redisFalso }));

const { cached, cachedBuffer, TTL } = await import("../src/utils/externalCache.js");

beforeEach(() => {
  loja.clear();
  redisFalso.get.mockClear();
  redisFalso.setex.mockClear();
  redisFalso.get.mockImplementation(async (k) => (loja.has(k) ? loja.get(k) : null));
  redisFalso.setex.mockImplementation(async (k, _ttl, v) => loja.set(k, v));
});

describe("cached", () => {
  it("consulta o serviço externo uma vez e reaproveita", async () => {
    const buscar = vi.fn().mockResolvedValue({ lat: -3.4, lon: -60.4 });

    const a = await cached("geocode", "rua x", TTL.geocode, buscar);
    const b = await cached("geocode", "rua x", TTL.geocode, buscar);

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("entradas diferentes não colidem", async () => {
    const buscar = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });
    expect(await cached("geocode", "rua x", 60, buscar)).toEqual({ v: 1 });
    expect(await cached("geocode", "rua y", 60, buscar)).toEqual({ v: 2 });
  });

  it("namespaces diferentes não colidem com a mesma entrada", async () => {
    // Um IP e um endereço poderiam gerar o mesmo texto num caso de borda.
    const buscar = vi.fn().mockResolvedValueOnce({ v: "geo" }).mockResolvedValueOnce({ v: "ip" });
    expect(await cached("geocode", "mesma", 60, buscar)).toEqual({ v: "geo" });
    expect(await cached("geoip", "mesma", 60, buscar)).toEqual({ v: "ip" });
  });

  it("NÃO cacheia resultado nulo", async () => {
    /*
     * Um endereço que não geocodificou hoje pode geocodificar amanhã. Gravar a
     * ausência transformaria uma falha transitória de rede em ausência
     * permanente no laudo, que é pior que consultar de novo.
     */
    const buscar = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ lat: 1, lon: 2 });

    expect(await cached("geocode", "rua z", 60, buscar)).toBeNull();
    expect(await cached("geocode", "rua z", 60, buscar)).toEqual({ lat: 1, lon: 2 });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("grava com o TTL informado", async () => {
    await cached("geoip", "1.2.3.4", 12345, vi.fn().mockResolvedValue({ ok: true }));
    expect(redisFalso.setex.mock.calls[0][1]).toBe(12345);
  });

  it("a chave não contém a entrada em claro", async () => {
    // Endereço residencial é dado pessoal: não deve virar nome de chave no Redis.
    await cached("geocode", "Rua Solimões, Manaquiri", 60, vi.fn().mockResolvedValue({ v: 1 }));
    const chave = redisFalso.setex.mock.calls[0][0];
    expect(chave).not.toContain("Solimões");
    expect(chave).not.toContain("Manaquiri");
  });
});

describe("fail-open quando o Redis falha", () => {
  it("leitura quebrada não impede a consulta externa", async () => {
    redisFalso.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const buscar = vi.fn().mockResolvedValue({ lat: 1, lon: 2 });

    await expect(cached("geocode", "rua x", 60, buscar)).resolves.toEqual({ lat: 1, lon: 2 });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("gravação quebrada não derruba o resultado já obtido", async () => {
    // O pior caso aceitável é o comportamento anterior ao cache: consultar
    // sempre. Nunca é deixar o laudo sem o dado.
    redisFalso.setex.mockRejectedValue(new Error("OOM"));
    const buscar = vi.fn().mockResolvedValue({ lat: 1, lon: 2 });

    await expect(cached("geocode", "rua x", 60, buscar)).resolves.toEqual({ lat: 1, lon: 2 });
  });
});

describe("cachedBuffer", () => {
  it("devolve Buffer idêntico ao original", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    const buscar = vi.fn().mockResolvedValue(png);

    const primeiro = await cachedBuffer("staticmap", "url", 60, buscar);
    const segundo = await cachedBuffer("staticmap", "url", 60, buscar);

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(segundo)).toBe(true);
    expect(segundo.equals(primeiro)).toBe(true);
    expect(segundo.equals(png)).toBe(true);
  });

  it("armazena em base64, não como JSON de Buffer", async () => {
    // JSON.stringify de Buffer produz {"type":"Buffer","data":[...]}, cerca de
    // quatro vezes o tamanho. A imagem mora em memória: o formato importa.
    await cachedBuffer("staticmap", "url", 60, vi.fn().mockResolvedValue(Buffer.from("abc")));
    const gravado = redisFalso.setex.mock.calls[0][2];
    expect(gravado).toBe(Buffer.from("abc").toString("base64"));
    expect(gravado).not.toContain("Buffer");
  });

  it("não cacheia mapa ausente", async () => {
    const buscar = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(Buffer.from("ok"));
    expect(await cachedBuffer("staticmap", "url", 60, buscar)).toBeNull();
    expect((await cachedBuffer("staticmap", "url", 60, buscar)).toString()).toBe("ok");
  });
});

describe("teto de tamanho", () => {
  it("não cacheia imagem anômala, mas devolve o resultado", async () => {
    /*
     * O cache de mapas consome memória proporcional ao volume, e memória do
     * Redis é o recurso que a fase 2 está tentando desafogar. Uma resposta muito
     * acima do tamanho típico (100 a 250 KB) indica mudança na API ou erro
     * devolvido como imagem: guardá-la envenena a memória sem acerto útil.
     */
    const gigante = Buffer.alloc(2 * 1024 * 1024, 1);
    const buscar = vi.fn().mockResolvedValue(gigante);

    const r = await cachedBuffer("staticmap", "url-grande", 60, buscar);

    expect(r.equals(gigante)).toBe(true);
    expect(redisFalso.setex).not.toHaveBeenCalled();
  });

  it("imagem de tamanho normal continua sendo cacheada", async () => {
    await cachedBuffer("staticmap", "url-normal", 60, vi.fn().mockResolvedValue(Buffer.alloc(200 * 1024)));
    expect(redisFalso.setex).toHaveBeenCalledTimes(1);
  });
});
