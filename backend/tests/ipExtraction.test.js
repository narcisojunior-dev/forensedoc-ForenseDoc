import { describe, it, expect } from "vitest";
import { extractIpAddresses } from "../src/utils/ipExtraction.js";

/**
 * Regressão do defeito relatado: "o endereço do IP não é verificado
 * corretamente, nos últimos testes não foi gerado".
 *
 * O extrator antigo era `/\b((?:\d{1,3}\.){3}\d{1,3})\b/` e produzia dois erros
 * graves num laudo pericial:
 *
 *   1. INVENTAVA PROVA. "Chrome/130.0.0.0" e numeração de seção "3.3.3.1"
 *      entravam no § 6 como endereços IP que nunca estiveram no documento.
 *   2. PERDIA O IP REAL. Assinadores brasileiros registram IPv6 na rede móvel;
 *      nenhum era capturado, e o laudo declarava "nenhum endereço IP
 *      identificado" sobre um documento que trazia o endereço explicitamente.
 *
 * O trecho abaixo reproduz o formato real do dossiê de trilha de auditoria
 * usado como documento de teste.
 */
const TRECHO_REAL =
  "ASSINADO ELETRONICAMENTE POR: IRAILZO SEIXAS PINTO CPF: 896.436.402-30 " +
  "Data e hora: 25/06/2025 10:45:03 " +
  "IP e Porta Lógica: 2804:18:6881:4f33:e868:6941:39ee:81fc: 56256 " +
  "Latitude e Longitude: -3.4340189 / -60.4593232 " +
  "Navegador e versão do celular: Mozilla/5.0 (Linux; Android 10; K) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36 " +
  "Identificador do aparelho: Cw8VBYf2zdyHZHfr0Wx7";

describe("extractIpAddresses — documento real", () => {
  const achados = extractIpAddresses(TRECHO_REAL);

  it("encontra exatamente um endereço", () => {
    expect(achados).toHaveLength(1);
  });

  it("captura o IPv6 completo, sem a porta", () => {
    expect(achados[0].endereco).toBe("2804:18:6881:4f33:e868:6941:39ee:81fc");
    expect(achados[0].versao).toBe(6);
    expect(achados[0].porta).toBe("56256");
  });

  it("registra o rótulo com que o assinador identificou o dado", () => {
    // O rótulo é o que dá confiabilidade ao achado e vai para o laudo.
    expect(achados[0].rotulo).toBe("IP e Porta Lógica");
  });

  it("associa data/hora e dispositivo ao endereço", () => {
    expect(achados[0].data_hora).toBe("25/06/2025 10:45:03");
    expect(achados[0].user_agent).toContain("SamsungBrowser/28.0");
  });

  it("NÃO trata a versão do Chrome como endereço IP", () => {
    // Era o falso positivo mais grave: o laudo afirmava que o documento
    // registrava o IP 130.0.0.0.
    expect(achados.map((a) => a.endereco)).not.toContain("130.0.0.0");
  });
});

describe("rejeição de falsos positivos", () => {
  it("descarta números de versão de navegador", () => {
    for (const texto of [
      "Chrome/130.0.0.0 Safari/537.36",
      "AppleWebKit/537.36 (KHTML)",
      "Firefox/121.0.0.1",
      "versão 10.0.0.1 do aplicativo",
    ]) {
      expect(extractIpAddresses(texto)).toHaveLength(0);
    }
  });

  it("descarta numeração de seção com todos os octetos baixos", () => {
    expect(extractIpAddresses("Cláusula 3.3.3.1 e item 2.1.4.5")).toHaveLength(0);
  });

  it("descarta faixas privadas e reservadas", () => {
    for (const ip of ["192.168.0.1", "10.0.0.5", "172.16.9.9", "127.0.0.1", "169.254.1.1", "0.0.0.0"]) {
      expect(extractIpAddresses(`Endereço IP: ${ip}`)).toHaveLength(0);
    }
  });

  it("descarta IPv6 loopback e link-local", () => {
    for (const ip of ["::1", "fe80::1ff:fe23:4567:890a", "fd00::1"]) {
      expect(extractIpAddresses(`IP: ${ip}`)).toHaveLength(0);
    }
  });

  it("descarta IPv4 com octeto acima de 255", () => {
    expect(extractIpAddresses("Endereço IP: 300.1.2.3")).toHaveLength(0);
  });
});

describe("captura de IPv4 público", () => {
  it("aceita endereço roteável com rótulo", () => {
    const r = extractIpAddresses("Endereço IP: 189.4.22.10 registrado em 15/03/2026");
    expect(r).toHaveLength(1);
    expect(r[0].endereco).toBe("189.4.22.10");
    expect(r[0].versao).toBe(4);
    expect(r[0].rotulo).toMatch(/Endere/i);
  });

  it("separa a porta anexada ao IPv4", () => {
    const r = extractIpAddresses("IP do signatário: 189.4.22.10:44321");
    expect(r[0].endereco).toBe("189.4.22.10");
    expect(r[0].porta).toBe("44321");
  });

  it("aceita endereço sem rótulo, marcando a menor confiança", () => {
    const r = extractIpAddresses("Conexão originada de 200.147.35.149 no ato.");
    expect(r).toHaveLength(1);
    expect(r[0].rotulo).toBeNull();
    expect(r[0].contexto).toMatch(/sem rótulo/i);
  });
});

describe("ordenação e deduplicação", () => {
  it("deduplica o mesmo endereço repetido em vários eventos", () => {
    // Dossiês de trilha de auditoria repetem o IP em cada etapa do fluxo.
    const texto = "IP: 189.4.22.10 ... depois IP: 189.4.22.10 ... e IP: 189.4.22.10";
    expect(extractIpAddresses(texto)).toHaveLength(1);
  });

  it("lista o endereço rotulado antes do encontrado solto", () => {
    const r = extractIpAddresses("Vi 200.147.35.149 no log. Endereço IP: 189.4.22.10");
    expect(r[0].endereco).toBe("189.4.22.10");
    expect(r[0].rotulo).not.toBeNull();
  });

  it("promove a rotulado um endereço antes visto solto", () => {
    const r = extractIpAddresses("Origem 189.4.22.10 no evento. Endereço IP: 189.4.22.10");
    expect(r).toHaveLength(1);
    expect(r[0].rotulo).not.toBeNull();
  });
});

describe("robustez", () => {
  it("não estoura com entrada vazia ou inválida", () => {
    for (const entrada of ["", null, undefined, 42]) {
      expect(extractIpAddresses(entrada)).toEqual([]);
    }
  });

  it("tolera texto longo sem IP", () => {
    expect(extractIpAddresses("lorem ipsum ".repeat(500))).toEqual([]);
  });
});
