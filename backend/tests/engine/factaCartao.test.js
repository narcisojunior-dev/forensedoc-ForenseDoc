import { test } from "vitest";
import assert from "node:assert/strict";
import { extractFactaCartaoConsignado, isFactaCartaoConsignado } from "../../src/engine/factaCartao.js";

// Trechos reconstruídos a partir das evidências citadas no relatório técnico
// de 09/09/2026 (fixture Facta, proposta 66627014). TEXT preserva quebras de
// linha e o espaçamento largo entre colunas, como a saída de "pdftotext
// -layout"; FLAT é o texto achatado (espaços/quebras colapsados) que o
// restante do backend usa para os demais campos.
const TEXT = [
  "Facta Financeira S.A. Crédito, Financiamento e Investimento, Rua dos Andradas, 1409, 7º andar,",
  "Centro, Porto Alegre - RS, CEP 90020-011, CNPJ 15.581.638/0001-30",
  "Proposta de Adesão nº 66627014",
  "Nome                              CPF                  Data Nascimento",
  "FRANCISCO DE SOUSA CAVALCANTE     150.952.403-78       26/08/1952",
  "Endereço                          Bairro               CEP",
  "RUA R                             ZONA RURAL           64108-000",
  "Cidade                            UF                   Telefone",
  "BOA HORA                          PI                   98807-8139",
  "VI - Saque",
  "Valor limite do cartão de crédito: R$ 2.008,09 Taxa de juros ao mês: 2.83%",
  "Valor máximo para saque: R$ 1.405,66 Taxa de juros ao ano: 39.78%",
  "Valor consignado para pgto. do valor mínimo indicado na fatura: R$ 46,20 Custo Efetivo Total ao mês: 2.90%",
  "Taxa pela emissão do cartão: R$ 15,00 Custo Efetivo Total ao ano: 41.54%",
  "Prazo previsto para liquidação do saldo: 84 meses IOF: R$ 43,04",
  "Localização: IP DE ACESSO:",
  "-4.2760162,-41.7788724 191.45.47.229",
  "Acesso ao APP: 17/10/2023 12:24:25",
  "Dispositivo utilizado: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  "Aceite dos Termos e Condições: 17/10/2023 12:24:31",
  "Aceite e emissão da CCB: 17/10/2023 12:24:54",
  "Assinado eletronicamente por: FRANCISCO DE SOUSA CAVALCANTE- 17/10/2023 12:28:57",
  "Data da Assinatura: 17/10/2023 12:28:57",
  "FACEMATCH: 99% de assertividade",
  "BASE PÚBLICA: SERPRO",
  "SCORE: NÃO LOCALIZADO",
].join("\n");
const FLAT = TEXT.replace(/\s+/g, " ").trim();

test("detecta o layout Facta pelo nome da instituição", () => {
  assert.equal(isFactaCartaoConsignado(FLAT), true);
  assert.equal(isFactaCartaoConsignado("Banco Bradesco S.A."), false);
});

test("extrai banco, CNPJ e número da proposta", () => {
  const result = extractFactaCartaoConsignado(TEXT, FLAT);
  assert.equal(result.isFacta, true);
  assert.equal(result.modalidade, "RMC");
  assert.match(result.banco, /Facta Financeira/);
  assert.equal(result.cnpjInstituicao, "15581638000130");
  assert.equal(result.contratoNumero, "66627014");
});

test("extrai a qualificação da tabela sem embaralhar as colunas", () => {
  const result = extractFactaCartaoConsignado(TEXT, FLAT);
  assert.equal(result.clienteNome, "FRANCISCO DE SOUSA CAVALCANTE");
  assert.equal(result.clienteCpf, "150.952.403-78");
  assert.equal(result.clienteDataNascimento, "26/08/1952");
  assert.equal(result.clienteEndereco, "RUA R");
  assert.equal(result.clienteBairro, "ZONA RURAL");
  assert.equal(result.clienteCep, "64108-000");
  assert.equal(result.clienteCidade, "BOA HORA");
  assert.equal(result.clienteEstado, "PI");
  assert.equal(result.clienteTelefone, "98807-8139");
});

test("extrai os valores do cartão consignado (quadro VI - Saque)", () => {
  const { cartao } = extractFactaCartaoConsignado(TEXT, FLAT);
  assert.equal(cartao.limiteCartao, "R$ 2.008,09");
  assert.equal(cartao.valorMaximoSaque, "R$ 1.405,66");
  assert.equal(cartao.valorConsignadoMensal, "R$ 46,20");
  assert.equal(cartao.tarifaEmissao, "R$ 15,00");
  assert.equal(cartao.prazoPrevistoLiquidacaoMeses, 84);
  assert.equal(cartao.iof, "R$ 43,04");
  assert.equal(cartao.taxaJurosMensal, "2,83%");
  assert.equal(cartao.taxaJurosAnual, "39,78%");
  assert.equal(cartao.cetMensal, "2,90%");
  assert.equal(cartao.cetAnual, "41,54%");
});

test("extrai a trilha de auditoria com GPS e IP na ordem correta (não trocados)", () => {
  const { trilha } = extractFactaCartaoConsignado(TEXT, FLAT);
  assert.equal(trilha.latitude, -4.2760162);
  assert.equal(trilha.longitude, -41.7788724);
  assert.equal(trilha.ipAcesso, "191.45.47.229");
  assert.equal(trilha.acessoApp, "17/10/2023 12:24:25");
  assert.equal(trilha.aceiteTermos, "17/10/2023 12:24:31");
  assert.equal(trilha.aceiteCcb, "17/10/2023 12:24:54");
  assert.equal(trilha.dataAssinatura, "17/10/2023 12:28:57");
  assert.equal(trilha.titular, "FRANCISCO DE SOUSA CAVALCANTE");
  assert.equal(trilha.facematch, "99");
  assert.equal(trilha.basePublica, "SERPRO");
  assert.match(trilha.scoreBasePublica, /N[ÃA]O LOCALIZADO/);
});

test("usa a data de assinatura como data do contrato, nunca a data de nascimento", () => {
  const result = extractFactaCartaoConsignado(TEXT, FLAT);
  assert.equal(result.dataContrato, "17/10/2023");
  assert.notEqual(result.dataContrato, result.clienteDataNascimento);
});
