import { describe, it, expect } from "vitest";
import {
  CAMPOS_REVISAVEIS,
  validarCampos,
  lerCaminho,
  escreverCaminho,
} from "../src/services/fieldReview.js";

/**
 * A revisão pelo operador existe porque a extração é heurística e frágil a
 * formato novo: três documentos de bancos diferentes revelaram três falhas.
 *
 * O que os testes prendem é o que separa "conferência que fortalece a peça" de
 * "campo editável qualquer": a lista fechada, a validação de domínio e o
 * registro do valor anterior.
 */
describe("lista de campos revisáveis", () => {
  it("não permite editar o que o SISTEMA apura", () => {
    /*
     * Hash, fonte da geolocalização e classificação de divergência são
     * calculados, não lidos. Um laudo em que o hash pode ser digitado não prova
     * integridade nenhuma.
     */
    for (const proibido of [
      "hashes.sha256",
      "home.geo.lat",
      "contractGeo.divergencia",
      "ipAnalysis.0.geo.lat",
      "cadeiaCustodia.presentes",
    ]) {
      expect(CAMPOS_REVISAVEIS[proibido]).toBeUndefined();
    }
  });

  it("cobre os campos que faltaram nos documentos reais", () => {
    // Nome e coordenada declarada foram exatamente os que falharam.
    for (const esperado of [
      "cliente.nome",
      "cliente.cpf",
      "geolocalizacao_assinatura.latitude",
      "geolocalizacao_assinatura.longitude",
      "ips.0.endereco",
    ]) {
      expect(CAMPOS_REVISAVEIS[esperado]).toBeDefined();
    }
  });
});

describe("validação", () => {
  it("recusa campo fora da lista", () => {
    const r = validarCampos({ "hashes.sha256": "0".repeat(64) });
    expect(r.temErro).toBe(true);
    expect(r.erros["hashes.sha256"]).toMatch(/não pode ser corrigido/i);
  });

  it("valida o dígito verificador do CPF", () => {
    // Rejeita erro de digitação sem depender de consulta externa.
    expect(validarCampos({ "cliente.cpf": "111.111.111-11" }).temErro).toBe(true);
    expect(validarCampos({ "cliente.cpf": "036.112.833-98" }).temErro).toBe(false);
  });

  it("recusa coordenada fora do Brasil", () => {
    expect(validarCampos({ "geolocalizacao_assinatura.latitude": "48.85" }).temErro).toBe(true);
    expect(validarCampos({ "geolocalizacao_assinatura.longitude": "2.29" }).temErro).toBe(true);
    expect(validarCampos({ "geolocalizacao_assinatura.latitude": "-7.115" }).temErro).toBe(false);
  });

  it("aceita vírgula como separador decimal e normaliza", () => {
    const r = validarCampos({ "geolocalizacao_assinatura.latitude": "-7,115" });
    expect(r.validos["geolocalizacao_assinatura.latitude"]).toBe("-7.115");
  });

  it("valida endereço IP, aceitando IPv4 e IPv6", () => {
    expect(validarCampos({ "ips.0.endereco": "300.1.2.3" }).temErro).toBe(true);
    expect(validarCampos({ "ips.0.endereco": "189.40.112.87" }).temErro).toBe(false);
    expect(validarCampos({ "ips.0.endereco": "2804:18::1" }).temErro).toBe(false);
  });

  it("campo vazio limpa o valor em vez de virar string vazia", () => {
    // O laudo distingue "não localizado" de valor presente. Uma string vazia
    // apareceria como presente e em branco.
    expect(validarCampos({ "cliente.nome": "   " }).validos["cliente.nome"]).toBeNull();
  });

  it("devolve TODOS os erros de uma vez", () => {
    // O operador está diante de um formulário: corrigir um campo por vez, com
    // uma ida ao servidor para cada, é atrito gratuito.
    const r = validarCampos({
      "cliente.cpf": "111.111.111-11",
      "geolocalizacao_assinatura.latitude": "99",
      "ips.0.endereco": "nao-e-ip",
    });
    expect(Object.keys(r.erros)).toHaveLength(3);
  });
});

describe("leitura e escrita por caminho", () => {
  it("lê e escreve dentro de objetos aninhados", () => {
    const o = { cliente: { nome: "Antigo" } };
    expect(lerCaminho(o, "cliente.nome")).toBe("Antigo");
    escreverCaminho(o, "cliente.nome", "Novo");
    expect(o.cliente.nome).toBe("Novo");
  });

  it("cria a estrutura que faltar, inclusive array", () => {
    // O caso real: o documento não trazia IP nenhum, então `ips` não existe e o
    // operador vai informar o primeiro.
    const o = {};
    escreverCaminho(o, "ips.0.endereco", "189.40.112.87");
    expect(Array.isArray(o.ips)).toBe(true);
    expect(o.ips[0].endereco).toBe("189.40.112.87");
  });

  it("não estoura em caminho inexistente", () => {
    expect(lerCaminho({}, "a.b.c")).toBeUndefined();
  });
});
