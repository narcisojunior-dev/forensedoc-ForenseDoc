import { describe, it, expect } from "vitest";
import { extractIpAddresses, ehCompartilhado } from "../src/utils/ipExtraction.js";

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

/**
 * IPv4 é o caso com MAIS superfície de erro que o IPv6, não menos: números de
 * versão e de seção têm o mesmo formato de um endereço IPv4, e vários deles são
 * roteáveis de verdade. Um "2.14.0.1" solto no texto geolocaliza em Orange S.A.,
 * França, e entraria no laudo como origem da assinatura.
 */
describe("extractIpAddresses — documentos com IPv4", () => {
  it("captura endereço rotulado com porta separada por espaço", () => {
    // A quebra de linha do PDF insere o espaço, e a porta se perdia.
    const [ip] = extractIpAddresses("IP e Porta Lógica: 189.40.112.87: 44210");
    expect(ip.endereco).toBe("189.40.112.87");
    expect(ip.porta).toBe("44210");
    expect(ip.versao).toBe(4);
  });

  it("captura endereço rotulado sem porta e endereço solto no texto", () => {
    expect(extractIpAddresses("Endereço de IP: 200.155.8.42")[0].endereco).toBe("200.155.8.42");
    expect(extractIpAddresses("acesso originado de 177.220.170.1 conforme registro")[0].endereco)
      .toBe("177.220.170.1");
  });

  it("descarta número de versão separado do rótulo por outras palavras", () => {
    // O caso que passava: CONTEXTO_RUIDOSO exigia adjacência ("Chrome/130.0.0.0").
    for (const texto of [
      "Versão do aplicativo 2.14.0.1 instalada",
      "build do sistema 5.2.1.3",
      "revisão do módulo 8.1.2.3",
    ]) {
      expect(extractIpAddresses(texto)).toEqual([]);
    }
  });

  it("o rótulo explícito prevalece sobre a heurística de versão", () => {
    // Se o documento DIZ que é IP, a declaração do instrumento vence.
    const r = extractIpAddresses("Versão do app: IP de origem 191.5.60.10");
    expect(r).toHaveLength(1);
    expect(r[0].endereco).toBe("191.5.60.10");
  });

  it("continua descartando user-agent, cláusula e faixas privadas", () => {
    expect(extractIpAddresses("AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36")).toEqual([]);
    expect(extractIpAddresses("Cláusula 3.3.3.1 do instrumento")).toEqual([]);
    expect(extractIpAddresses("IP do signatário: 192.168.0.15")).toEqual([]);
    expect(extractIpAddresses("conexão local 127.0.0.1")).toEqual([]);
  });

  it("marca CGNAT, que é o padrão de IPv4 em banda larga e móvel no Brasil", () => {
    const [ip] = extractIpAddresses("IP e Porta Lógica: 100.64.12.9: 31002");
    expect(ip.endereco).toBe("100.64.12.9");
    expect(ip.compartilhado).toBe(true);
    // A porta é o que ainda permite identificar o assinante junto à operadora.
    expect(ip.porta).toBe("31002");
  });

  it("não marca como compartilhado um IPv4 público nem um IPv6", () => {
    expect(ehCompartilhado("189.40.112.87")).toBe(false);
    expect(ehCompartilhado("100.128.0.1")).toBe(false); // fora da /10
    expect(ehCompartilhado("2804:18::1")).toBe(false);
  });
});
