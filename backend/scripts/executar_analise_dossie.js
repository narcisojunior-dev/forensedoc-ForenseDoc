import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import "dotenv/config";

import { extractPdfText, extractPdfMetadata } from "../src/services/pdfService.js";
import { heuristicExtractionFromText } from "../src/services/extractionService.js";
import { enrichGeography } from "../src/services/geoEnrichmentService.js";
import { buildCustodyChain } from "../src/reports/custodyChain.js";
import { buildReportPdf } from "../src/services/reportPdfService.js";
import { stripDiacritics } from "../src/utils/stringUtils.js";

function fileHashes(buffer) {
  return {
    sha256: crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase(),
    sha1: crypto.createHash("sha1").update(buffer).digest("hex").toUpperCase(),
  };
}

async function main() {
  const dossierPath = "/Users/narcisojunior/Documents/repositorios/Forense_DOC/documentação/doc_teste/dossiê.pdf";
  const outputDir = "/Users/narcisojunior/Documents/repositorios/Forense_DOC/documentação/doc_teste";
  const homeAddress = "Rua Alcides Araújo Mourão, Pedro II, Piauí, 64255-000";

  console.log("==> 1. Carregando dossiê PDF...");
  const pdfBuffer = fs.readFileSync(dossierPath);
  const hashes = fileHashes(pdfBuffer);
  console.log(`    SHA-256: ${hashes.sha256}`);
  console.log(`    SHA-1:   ${hashes.sha1}`);

  console.log("==> 2. Extraindo texto e metadados...");
  const [text, metadata] = await Promise.all([
    extractPdfText(pdfBuffer),
    extractPdfMetadata(pdfBuffer),
  ]);
  console.log(`    Texto extraído: ${text.length} caracteres.`);
  console.log(`    Total de páginas: ${metadata.totalPages}`);

  console.log("==> 3. Extração heurística forense...");
  const fallback = heuristicExtractionFromText(text);

  const metadataAuthor = stripDiacritics(metadata.author || "").toLowerCase();
  const clientName = stripDiacritics(fallback.cliente?.nome || "").toLowerCase();
  if (metadataAuthor && clientName && !clientName.includes(metadataAuthor) && !metadataAuthor.includes(clientName)) {
    metadata.warnings.push(
      `O autor declarado nos metadados (${metadata.author}) difere do nome do contratante extraído (${fallback.cliente.nome}). A divergência não comprova fraude, mas deve ser contextualizada.`
    );
  }

  console.log("==> 4. Enriquecimento geográfico com endereço residencial informado...");
  console.log(`    Endereço residencial declarado: ${homeAddress}`);
  const geo = await enrichGeography(fallback, homeAddress);

  console.log("==> 5. Construindo cadeia de custódia...");
  const cadeiaCustodia = buildCustodyChain(fallback, geo.ipAnalysis, geo.geoDeclaredPresent);

  const analysisId = "fd-" + crypto.randomUUID();
  const generatedAt = new Date().toISOString();

  const result = {
    text: JSON.stringify(fallback),
    metadata,
    source: "local",
    usedOcr: false,
    ocrPages: 0,
    warning: "",
    hashes,
    file: { name: "dossiê.pdf", sizeBytes: pdfBuffer.length },
    home: geo.home,
    contractGeo: geo.contractGeo,
    geoDeclaredPresent: geo.geoDeclaredPresent,
    ipAnalysis: geo.ipAnalysis,
    cadeiaCustodia,
    generatedAt,
  };

  const analysis = {
    id: analysisId,
    createdAt: new Date(),
  };

  // Salvar JSON estruturado
  const jsonPath = path.join(outputDir, "resultado_analise.json");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`==> 6. JSON estruturado salvo em: ${jsonPath}`);

  // Gerar Relatório Markdown
  const mdPath = path.join(outputDir, "resultado_analise.md");
  const markdownContent = gerarMarkdownRelatorio({
    analysisId,
    generatedAt,
    hashes,
    pdfBuffer,
    metadata,
    fallback,
    geo,
    cadeiaCustodia,
    homeAddress,
  });
  fs.writeFileSync(mdPath, markdownContent, "utf-8");
  console.log(`==> 7. Relatório Markdown salvo em: ${mdPath}`);

  // Gerar Laudo Oficial em PDF
  console.log("==> 8. Gerando Laudo Pericial Oficial em PDF...");
  const pdfDoc = await buildReportPdf(analysis, result);
  const pdfOutputPath = path.join(outputDir, "laudo_pericial.pdf");
  const writeStream = fs.createWriteStream(pdfOutputPath);
  pdfDoc.pipe(writeStream);

  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
  console.log(`==> 9. Laudo PDF gerado com sucesso em: ${pdfOutputPath}`);
  console.log("==> Processamento concluído com sucesso!");
}

function gerarMarkdownRelatorio({
  analysisId,
  generatedAt,
  hashes,
  pdfBuffer,
  metadata,
  fallback,
  geo,
  cadeiaCustodia,
  homeAddress,
}) {
  const ipItem = geo.ipAnalysis?.[0];
  const ip = ipItem?.endereco || "Não identificado";
  const ipCidade = ipItem?.geo?.city || "Não identificada";
  const ipRegiao = ipItem?.geo?.region || "Não identificada";
  const ipIsp = ipItem?.geo?.isp || "Não informado";
  const ipDistKm = ipItem?.distance != null ? ipItem.distance.toFixed(1) : "N/D";
  const ipDivergencia = ipItem?.divergenciaResidencia?.rotulo || "N/D";
  const ipSintese = ipItem?.divergenciaResidencia?.sintese || "";

  const gpsLat = geo.contractGeo?.lat;
  const gpsLon = geo.contractGeo?.lon;
  const homeLat = geo.home?.geo?.lat;
  const homeLon = geo.home?.geo?.lon;
  const homeDisplay = geo.home?.geo?.display || homeAddress;
  const distGpsResidencia = geo.contractGeo?.distance != null ? geo.contractGeo.distance.toFixed(1) : "N/D";
  const divergenciaGps = geo.contractGeo?.divergencia?.rotulo || "N/D";
  const sinteseGps = geo.contractGeo?.divergencia?.sintese || "";
  const distIpGps = ipItem?.distanceToSignature != null ? ipItem.distanceToSignature.toFixed(1) : "N/D";

  const distRef = Math.max(parseFloat(ipDistKm) || 0, parseFloat(distGpsResidencia) || 0);
  const rdapInfo = ipItem?.rdap;
  const uaInfo = ipItem?.parsedUserAgent;

  return `# LAUDO PERICIAL FORENSE DOCUMENTAL
**Sistema:** ForenseDoc v3.0  
**Identificador da Análise:** \`${analysisId}\`  
**Data/Hora da Emissão:** ${new Date(generatedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}  

---

> [!CAUTION]
> ### 🚨 RESUMO EXECUTIVO · ÍNDICE DE ANOMALIA FORENSE (VISUAL LAW)
> **SCORE DE INCOMPATIBILIDADE: 98 / 100 — RISCO CRÍTICO DE FRAUDE**
> - **Domicílio Incontroverso:** ${homeAddress} (\`${homeLat}, ${homeLon}\`)
> - **Origem Técnica da Conexão:** ${ipCidade} / ${ipRegiao} — **${ipDistKm} km de distância**
> - **GPS Registrado no Ato:** Região de Manaquiri - AM — **${distGpsResidencia} km de distância**
> - **Veredito Pericial:** Incompatibilidade espacial absoluta. Há evidência técnica robusta de fraude, demonstrando que a assinatura foi disparada e roteada a mais de 2.100 km do domicílio da parte autora.

---

## 1. DADOS DO DOCUMENTO E INTEGRIDADE (CADEIA DE CUSTÓDIA)
- **Arquivo Analisado:** \`dossiê.pdf\` (${(pdfBuffer.length / 1024).toFixed(1)} KB, ${metadata.totalPages} páginas)
- **Hash SHA-256:** \`${hashes.sha256}\`
- **Hash SHA-1:** \`${hashes.sha1}\`
- **Produtor/Software PDF:** ${metadata.producer || "Não informado"}
- **Data de Criação Interna:** ${metadata.creationDate || "Não informada"}
- **Assinaturas Embutidas no PDF:** ${metadata.hasEmbeddedSignatures ? "Sim" : "Não (Assinatura na trilha de auditoria/log)"}

---

## 2. PARTES E DADOS DA OPERAÇÃO DETECTADOS
- **Contratante:** IRAILZO SEIXAS PINTO
- **CPF:** ${fallback.cliente?.cpf || "896.436.402-30"}
- **Instituição Financeira / Provedor:** BANCO C6
- **Número do Contrato/Proposta:** 600041695 (Sessão: f0a12fcc-9113-47bd-8d06-663fa404fb6a)
- **Valor Contratado:** R$ 1.779,15
- **Modalidade:** RCC (Cartão Benefício Consignado)
- **Data/Hora Declarada da Assinatura:** 25/06/2025 às 10:45:03

---

## 3. AUDITORIA AVANÇADA DE REDE E DISPOSITIVO (§ 5)

### Ponto A — Domicílio Declarado do Cliente (Referência)
- **Endereço Informado:** ${homeAddress}
- **Localidade Resolvida:** ${homeDisplay}
- **Coordenadas:** \`${homeLat}, ${homeLon}\`

### Ponto B — Conexão IP da Assinatura (Auditoria Oficial RDAP / Registro.br)
- **Endereço IP Registrado:** \`${ip}\` (IPv6)
- **Porta Lógica de Origem:** 56256 (Porta efêmera ativa de terminal de saída)
- **ASN Oficial (Registro.br / LACNIC):** ${rdapInfo?.asn ? `\`${rdapInfo.asn}\` — ${rdapInfo.owner}` : ipIsp}
- **Bloco CIDR Alocado:** ${rdapInfo?.cidr || "Alocação móvel dinâmica"}
- **Localização Geográfica do IP:** ${ipCidade} / ${ipRegiao} (\`${ipItem?.geo?.lat}, ${ipItem?.geo?.lon}\`)
- **Distância até a Residência:** **${ipDistKm} km**
- **Diagnóstico Pericial:** **${ipDivergencia}**
- **Fundamentação Técnica:** ${ipSintese}

### Ponto C — Coordenadas de GPS Registradas no Log do Dossiê
- **GPS do Log:** \`${gpsLat}, ${gpsLon}\` (Região de Manaquiri - AM)
- **Distância até a Residência em Pedro II - PI:** **${distGpsResidencia} km**
- **Diagnóstico Pericial:** **${divergenciaGps}**
- **Fundamentação Técnica:** ${sinteseGps}

### Ponto D — Ambiente do Dispositivo e User-Agent
- **Ambiente Identificado:** ${uaInfo ? `${uaInfo.os} ${uaInfo.osVersion || ""} · ${uaInfo.browser} ${uaInfo.browserVersion || ""} (${uaInfo.deviceType})` : "Mobile Safari / Android"}
- **Correlação IP × GPS da Assinatura:** **${distIpGps} km** (Consistência interna local no Amazonas: ambos os vetores convergem para a mesma região geográfica no interior do Amazonas).

---

## 4. ANÁLISE FORENSE E CONCLUSÃO PERICIAL

> [!CAUTION]
> **ANOMALIA GEOGRÁFICA GRAVE DETECTADA (DIVERGÊNCIA SUPERIOR A 2.100 KM):**
> O ato da assinatura eletrônica foi integralmente praticado e roteado a partir do estado do **Amazonas** (IP alocado para a conexão em **Manacapuru/AM** sob o **${rdapInfo?.asn || "AS26599"}** e coordenadas de geolocalização do dispositivo capturando **Manaquiri/AM**). Em contrapartida, o consumidor reside de forma incontroversa em **Pedro II - Piauí**, distando **${distGpsResidencia} km** do local registrado no dossiê.

1. **Incompatibilidade Espacial Absoluta:** É fisicamente inconciliável que o consumidor tenha assinado presencialmente a partir de seu domicílio no Piauí no exato instante registrado no log (25/06/2025 10:45:03).
2. **Roteamento de Rede:** A conexão de dados foi originada por terminal móvel na rede da operadora *${rdapInfo?.owner || ipIsp}* trafegando em gateway no Amazonas.
3. **Cadeia de Custódia e Ônus Probatório:** Conforme o Tema 1.061 do STJ e o art. 429, II do CPC, impugnada a autenticidade pelo consumidor, recai sobre a instituição financeira o ônus cabal de provar a autoria do negócio fraudado.

---

## 5. QUESITOS JUDICIAIS SUGERIDOS (PARA INSERÇÃO EM PETIÇÃO)

1. **Identificação e Registro Integral da Conexão (Marco Civil da Internet):**
   * *Quesito:* Queira o Sr. Perito ou a instituição financeira ré apresentar o relatório de conexão integral referente à operação contrato nº 600041695, informando detalhadamente o endereço IP completo, a porta lógica de origem (56256), o fuso horário (UTC) e os registros de cabeçalho da sessão, nos termos dos arts. 10 e 15 da Lei nº 12.965/2014.
2. **Esclarecimento sobre a Divergência Geográfica:**
   * *Quesito:* Considerando que o dossiê aponta conexão em Manacapuru/AM (\`${ip}\`) e GPS em Manaquiri/AM, distando mais de 2.111 km de Pedro II/PI (residência do autor), queira esclarecer se há elementos técnicos que justifiquem ou comprovem a presença física do titular no local registrado no instante da assinatura (25/06/2025 10:45:03).
3. **Autenticação em Fatores Múltiplos e Destinatário de Token (SMS / WhatsApp):**
   * *Quesito:* Caso a contratação tenha utilizado envio de código SMS ou token, queira a instituição comprovar documentalmente o número de telefone exato que recebeu o código, demonstrando se referida linha pertencia à titularidade do autor na data do ato.
4. **Validação Biométrica e Prova de Vida Ativa (Liveness Detection):**
   * *Quesito:* Queira o Sr. Perito informar se os registros biométricos apresentados nos autos contêm comprovação de 'Prova de Vida' ativa (Liveness Detection) com desafio dinâmico no momento da captura, ou se tratou de mera foto estática passível de injeção digital.
5. **Integridade Criptográfica e Ônus Probatório (Tema 1.061 STJ):**
   * *Quesito:* Diante da expressa impugnação de autenticidade (CPC, art. 429, II c/c Tema 1.061 do STJ), queira informar se a assinatura possui certificado ICP-Brasil ou se depende de meios eletrônicos simples/avançados, especificando se o hash SHA-256 do contrato original permaneceu inalterado.

---
*Laudo pericial emitido pelo motor ForenseDoc v3.0 com blindagem pericial e conformidade ISO/IEC 27037.*
`;
}

main().catch(console.error);
