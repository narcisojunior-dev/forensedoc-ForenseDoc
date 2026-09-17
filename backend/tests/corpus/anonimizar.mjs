#!/usr/bin/env node
/**
 * Transforma um dossiê real num caso de corpus, sem dado pessoal.
 *
 *   node tests/corpus/anonimizar.mjs <arquivo.pdf> <mapa.json> <saida.json>
 *
 * ─── A restrição que define esta ferramenta ──────────────────────────────────
 *
 * Os documentos que expõem defeitos de extração são dossiês reais, com CPF,
 * endereço, telefone e por vezes referência biométrica de TERCEIROS que não são
 * clientes do sistema e nunca interagiram com ele. Versioná-los seria acúmulo de
 * dado pessoal sem base legal, replicado em toda cópia do repositório, em todo
 * backup e na máquina de qualquer pessoa que clone o projeto.
 *
 * ─── Por que substituir, e nunca apagar ──────────────────────────────────────
 *
 * Todos os defeitos encontrados até aqui foram sensíveis à FORMA, não ao
 * conteúdo:
 *
 *   caixa alta contra Title Case          (nome do contratante virou "Do Cliente")
 *   três contra quatro casas decimais     (geolocalização dada como ausente)
 *   IPv4 contra IPv6                      (IP não extraído)
 *   rótulo antes contra depois do valor
 *
 * Trocar "LUCILENE FRANCA ABREU" por "[REDIGIDO]" destruiria exatamente a
 * propriedade que o teste precisa verificar. A substituição preserva caixa,
 * número de palavras, máscara e número de casas decimais.
 *
 * ─── O mapa é escrito à mão, de propósito ────────────────────────────────────
 *
 * Detecção automática de dado pessoal erra, e o erro aqui não é um teste que
 * falha: é um CPF real dentro do repositório, que é incidente de proteção de
 * dados. O operador declara cada substituição, e a ferramenta faz duas coisas
 * que a mão não faz de forma confiável: aplica de forma CONSISTENTE em todas as
 * ocorrências e VARRE o resultado atrás de resíduo.
 *
 * Formato do mapa:
 *
 *   {
 *     "origem": "Banco PAN, contrato de cartão consignado",
 *     "motivo": "Cabeçalho de tabela fazia o contratante virar 'Do Cliente'",
 *     "substituicoes": { "LUCILENE FRANCA ABREU": "MARIA APARECIDA SOUZA" },
 *     "esperado": { "cliente.nome": "Maria Aparecida Souza" },
 *     "proibido": { "cliente.nome": ["Do Cliente"] },
 *     "residuoPermitido": ["01406-000"]
 *   }
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractPdfTextDetailed } from "../../src/services/pdfService.js";
import { heuristicExtractionFromText } from "../../src/services/extractionService.js";

/**
 * Padrões que NÃO podem sobrar no texto anonimizado.
 *
 * Esta é a parte da ferramenta que evita incidente. Ela não confia no operador
 * ter listado tudo: varre o resultado e recusa gravar se encontrar algo com
 * cara de dado pessoal que não esteja entre os valores substituídos ou
 * explicitamente liberado em `residuoPermitido`.
 */
const PADROES_DE_RISCO = [
  { nome: "CPF", regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  { nome: "CNPJ", regex: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g },
  { nome: "CEP", regex: /\b\d{5}-\d{3}\b/g },
  { nome: "e-mail", regex: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
  { nome: "IPv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { nome: "IPv6", regex: /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi },
  { nome: "coordenada", regex: /-\d{1,2}[.,]\d{3,}/g },
  { nome: "telefone", regex: /\b(?:\(\d{2}\)\s?)?\d{4,5}-\d{4}\b/g },
];

/**
 * Campos identificados por RÓTULO, e não por formato.
 *
 * A varredura por padrão acima não pega nome de pessoa: nome não tem formato,
 * e qualquer heurística que tentasse reconhecê-lo confundiria "LUCIA FRANCA
 * ABREU" com "BANCO PAN S.A." em algum documento. Foi assim que o nome da MÃE
 * do contratante quase entrou no repositório na primeira geração deste corpus:
 * o mapa cobria o nome do titular, e a mãe aparece três linhas abaixo, sob
 * outro rótulo.
 *
 * O problema fica tratável quando se aceita que estes documentos são
 * FORMULÁRIOS: os dados pessoais estão sob rótulos, e são poucos rótulos. A
 * ferramenta exige que todo valor rotulado tenha sido substituído.
 */
const CAMPOS_ROTULADOS = [
  /\bNome\s+da\s+m[ãa]e\s*:?\s*\n?\s*([^\n]{4,80})/gi,
  /\bNome\s+(?:completo|do\s+cliente|do\s+titular|civil|social)?\s*:?\s*\n?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\n]{4,80})/g,
  /\bTelefone\s*:?\s*\n?\s*([\d()\s.-]{8,20})/gi,
  /\bCEP\s*:?\s*\n?\s*([\d.-]{8,10})/gi,
  /\bE-?mail\s*:?\s*\n?\s*([^\s\n]{6,60}@[^\s\n]{4,40})/gi,
  /\b(?:RG|Identidade)\s*:?\s*\n?\s*([\d.\-\/]{7,20})/gi,
  /\bData\s+de\s+nascimento\s*:?\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/gi,
];

function conferirRotulados(texto, mapa) {
  const substitutos = Object.values(mapa.substituicoes || {});
  const liberados = new Set(mapa.residuoPermitido || []);
  const achados = [];

  for (const regex of CAMPOS_ROTULADOS) {
    for (const [inteiro, valor] of texto.matchAll(regex)) {
      const limpo = (valor || "").trim();
      if (!limpo) continue;
      if (liberados.has(limpo)) continue;
      if (substitutos.some((s) => s.includes(limpo) || limpo.includes(s))) continue;
      achados.push(`${inteiro.replace(/\s+/g, " ").slice(0, 70)}`);
    }
  }
  return [...new Set(achados)];
}

function aplicar(texto, substituicoes) {
  let saida = texto;
  for (const [de, para] of Object.entries(substituicoes)) {
    if (!de) continue;
    // Substituição literal e global: o mesmo nome aparece dezenas de vezes num
    // dossiê, e trocar só a primeira deixaria as outras no arquivo.
    saida = saida.split(de).join(para);
  }
  return saida;
}

function conferirResiduo(texto, mapa) {
  const substitutos = Object.values(mapa.substituicoes || {});
  const liberados = new Set(mapa.residuoPermitido || []);

  /*
   * Um valor já substituído pode reaparecer PARCIALMENTE sob outro padrão: o
   * número de processo fictício `0800000-11.2026.8.10.0001` casa o padrão de
   * coordenada em `-11.2026`. Aceitar por continência evita transformar o
   * próprio substituto em achado e treinar o operador a ignorar o alerta, que
   * é como uma varredura de segurança perde a utilidade.
   */
  const foiSubstituido = (valor) => substitutos.some((s) => s.includes(valor));

  const achados = [];
  for (const { nome, regex } of PADROES_DE_RISCO) {
    for (const encontrado of texto.match(regex) || []) {
      if (liberados.has(encontrado) || foiSubstituido(encontrado)) continue;
      achados.push(`${nome}: ${encontrado}`);
    }
  }
  return [...new Set(achados)];
}

const [pdf, mapaPath, saida] = process.argv.slice(2);
if (!pdf || !mapaPath || !saida) {
  console.error("uso: node tests/corpus/anonimizar.mjs <arquivo.pdf> <mapa.json> <saida.json>");
  process.exit(1);
}

const mapa = JSON.parse(await readFile(mapaPath, "utf8"));
const bruto = (await extractPdfTextDetailed(await readFile(pdf))).text;
const texto = aplicar(bruto, mapa.substituicoes || {});

const residuo = [
  ...conferirResiduo(texto, mapa).map((r) => `[formato]  ${r}`),
  ...conferirRotulados(texto, mapa).map((r) => `[rótulo]   ${r}`),
];

if (residuo.length > 0) {
  console.error(
    `\nRECUSADO: ${residuo.length} valor(es) com cara de dado pessoal sobraram no texto.\n\n` +
      residuo.map((r) => `  ${r}`).join("\n") +
      "\n\nAcrescente cada um a `substituicoes` (se for dado real) ou a " +
      "`residuoPermitido` (se for do formulário e não de uma pessoa).\n"
  );
  process.exit(2);
}

// A extração roda sobre o texto JÁ anonimizado. É o que o teste vai executar, e
// conferir aqui evita descobrir na suíte que a substituição mudou um resultado.
const extraido = heuristicExtractionFromText(texto);

await writeFile(
  saida,
  JSON.stringify(
    {
      origem: mapa.origem,
      adicionadoEm: new Date().toISOString().slice(0, 10),
      motivo: mapa.motivo,
      esperado: mapa.esperado || {},
      proibido: mapa.proibido || {},
      texto,
    },
    null,
    1
  ) + "\n"
);

console.log(`${path.basename(saida)}: ${texto.length} caracteres, sem resíduo.`);
console.log("Confira os campos extraídos antes de commitar:\n");
for (const caminho of Object.keys(mapa.esperado || {})) {
  const valor = caminho.split(".").reduce((a, p) => (a == null ? undefined : a[p]), extraido);
  const bate = valor === mapa.esperado[caminho];
  console.log(`  ${bate ? "ok  " : "DIFERE"} ${caminho.padEnd(40)} ${JSON.stringify(valor)}`);
}
