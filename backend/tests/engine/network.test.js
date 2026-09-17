import { test } from "vitest";
import assert from "node:assert/strict";
import { classifyIpAddress, extractIpAddresses } from "../../src/engine/network.js";

test("extracts one IP used with several ports", () => {
  const text = "IP:Porta 177.51.242.26:55242 177.51.242.26:49243 177.51.242.26:65300";
  assert.deepEqual(extractIpAddresses(text), ["177.51.242.26"]);
});

test("does not treat a browser version as an IP", () => {
  const text = "Device Android 10 - Chrome 109.0.0.0 - 3887859466";
  assert.deepEqual(extractIpAddresses(text), []);
});

test("normalizes spaces inserted around IPv4 dots by OCR", () => {
  assert.deepEqual(extractIpAddresses("IP 177 . 51 . 242 . 26"), ["177.51.242.26"]);
});

test("does not concatenate clause numbers into fake IPv4 addresses", () => {
  const text = [
    "Conta do Cliente, indicada no Quadro item I-2.",
    "2.1.1 - No caso Portabilidade de Crédito",
    "de acordo com o Quadro III-2.",
    "2.8.1 - O valor de cada parcela",
    "referida na cláusula 2.10.2.",
    "2.11 - O Cliente poderá antecipar",
  ].join("\n");
  assert.deepEqual(extractIpAddresses(text), []);
});

test("supports IPv6 addresses", () => {
  assert.deepEqual(extractIpAddresses("IP 2001:db8:85a3::8a2e:370:7334"), ["2001:db8:85a3::8a2e:370:7334"]);
});

test("extracts full forwarding chain and preserves first-seen order", () => {
  const text = "IP: 177.54.151.211, 64.252.179.152, 10.42.92.128,\n ::ffff:127.0.0.1, 172.23.163.72, 10.42.158.0";
  assert.deepEqual(extractIpAddresses(text), [
    "177.54.151.211",
    "64.252.179.152",
    "10.42.92.128",
    "::ffff:127.0.0.1",
    "172.23.163.72",
    "10.42.158.0",
  ]);
});

test("classifies loopback, private and public IPs", () => {
  assert.equal(classifyIpAddress("::ffff:127.0.0.1"), "LOOPBACK");
  assert.equal(classifyIpAddress("10.42.92.128"), "PRIVADO RFC1918");
  assert.equal(classifyIpAddress("172.23.163.72"), "PRIVADO RFC1918");
  assert.equal(classifyIpAddress("177.54.151.211"), "PUBLICO");
});
