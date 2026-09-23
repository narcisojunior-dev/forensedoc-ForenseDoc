# Perícia em seis camadas: o que mudou no motor em 22/09/2026

Ronney Menezes Advocacia. Branch `pericia/seis-camadas`, sobre o `master` de 22/09/2026 (f888db0).

## Por que

Dois laudos reais mostraram o que o laudo deixava passar. O dossiê C6 (contrato 90140674306,
laudo FD-20260920-538F54AACD) saiu sem hash da única fotografia porque o `pdfimages` não
estava no ambiente; não disse que o ModDate era anterior ao CreationDate; não disse que o
PDF foi gerado no mesmo segundo da biometria; não mostrou que o aparelho era um Moto E32
com Chrome de 2021; e tratou o autor do template de Word como se fosse suspeita. A CCB do
Banco Master (27766845) tinha o mesmo "carimbo igual à geração".

O relatório `O que o perito examina num contrato eletrônico para dizer que ele é
irregular` (cofre do escritório, 22/09/2026) organiza a perícia em seis camadas: arquivo,
assinatura, identidade e biometria, rede e tempo, instrumento, dinheiro. Este branch fecha
as lacunas que o motor tinha em cada uma e faz o laudo dizer, achado por achado, o que ele
pode afirmar.

## O que entrou

| Camada | Mudança | Arquivos |
| --- | --- | --- |
| Arquivo | **INT3** ModDate anterior ao CreationDate; **INT4** CreationDate no instante do aceite ou da biometria (duas leituras de fuso); linhagem de template (Creator/Producer de editor de texto ou rótulos `MSIP_Label_`) rebaixa o aviso de autor para nota de rastreabilidade. | `engine/metadadosDatas.js`, `engine/analisarDocumento.js`, `engine/pdfForensics.js` (`rotulosMsip`) |
| Imagem | Inventário sem Poppler: objetos de imagem lidos do próprio arquivo (fluxo bruto, hash, EXIF, JFIF) e páginas pelo pdf.js. Entra quando `pdfimages` falta, falha (ENOENT) ou não lista nada. Mesmo formato de saída, mesmos achados IMG. | `engine/pdfImagensInterno.js`, `engine/pdfForensics.js` (`inspectPdfImagesInterno`) |
| Imagem | **IMG6** mesma fotografia biométrica em outra análise do mesmo tenant (busca pelo SHA-256 no `result` das análises concluídas). Bloco "Confronto com outros dossiês analisados" no § 4.4. | `services/imageReuseService.js`, `jobs/analysisWorker.js`, `services/reportPdfService.js` |
| Rede e tempo | Bloco **aparelho e navegador** no § 4.2 (modelo, sistema, navegador, identificador, user agent); **DEV2** navegador com mais de 12 meses na data do ato (tabela de versões do Chrome); **DEV3** identificador sem modelo. | `engine/dispositivo.js`, `engine/analisarDocumento.js`, `services/reportPdfService.js` |
| Rede | **Faixa do IP** pelo titular do bloco (operadora, provedor regional, hospedagem, VPN); campo "Natureza da rede" no § 5.3; achado **ip-infraestrutura** (ALTA) para hospedagem ou VPN no IP de acesso; diligência **origem-coordenada**. | `utils/ipFaixa.js`, `services/geoEnrichmentService.js`, `engine/irregularitySummary.js`, `services/reportPdfService.js` |
| Dinheiro | **LIB3** crédito registrado em favor de documento diverso do contratante, separado do LIB2. | `engine/comprovanteCredito.js` |
| Laudo | **Grau** de cada achado (constatado no arquivo, não verificável pelo arquivo, indício) e **âncora** (página e trecho) no § 6 do PDF e no § 8 da tela, com contagem por grau no topo da seção. Os achados novos já nascem com grau e âncora; os antigos são classificados pelo catálogo. | `engine/grauAchado.js`, `frontend/src/laudo/grauAchado.js`, `reports/laudoApresentacao.js`, `engine/irregularitySummary.js`, `services/reportPdfService.js`, `frontend/src/laudo/LaudoForense.jsx` |

| Geografia | **Referência em nível de município**: CEP genérico passa a resolver na sede do município (Nominatim, nó de lugar) em vez do centroide da área; ponto do ato no mesmo município da referência não recebe régua de quilômetros (veredito "mesmo município, distância não aferida"; estado `REFERENCIA_MUNICIPAL` quando nada resta a medir). Defeito real: laudo FD-20260922-ABC18B73E5 chamou de "divergência grave, 69,6 km" o GPS na sede de Manaquiri, cidade da cliente, porque a referência era o centroide do município, 55 km ao sul. | `utils/distancia.js` (e cópia em `frontend/src/laudo/distancia.js`), `utils/geoDivergence.js`, `services/geocodingService.js`, `services/geoEnrichmentService.js`, `engine/irregularitySummary.js`, `services/reportPdfService.js` |

Códigos novos: INT3, INT4, DEV2, DEV3, LIB3, IMG6, ip-infraestrutura. Estado novo do confronto: REFERENCIA_MUNICIPAL.

## Integração com o `master` de 22/09 (PR #3: ELA, graus de conclusão, cláusulas de adesão)

O branch foi rebaseado sobre df00228. Os graus usam um só módulo, `engine/grausConclusao.js`
(e a cópia do frontend), no vocabulário dele: `CONSTATADO`, `NÃO VERIFICÁVEL`, `INDÍCIO`. O
catálogo ganhou os códigos novos e os que antes caíam no fallback por gravidade (hash-missing,
simple-signature, device-gap, gps-ip-conflict, entre outros). O § 6 do PDF imprime grau e âncora
por achado, com a contagem no topo; a tela mantém o selo de grau do PR #3 e ganha a âncora. A
análise ELA (sharp) passou a rodar também no inventário interno, sem Poppler. Diligência nova:
origem-coordenada. Campos novos no `extracted`: `dispositivo`, `reuso_imagens`; nos achados:
`grau`, `ancora`; no `metadata`: `rotulosMsip`, `linhagemTemplate`; em `imagens_pdf`:
`ferramenta`, `objetos_no_arquivo`; em `ipAnalysis[]`: `faixa`.

## O que os dois dossiês reais passaram a dizer

C6 (26_CCB): INT3 (134 dias), INT4 (mesmo segundo), DEV2 (Chrome 94, 38 meses), aparelho
"moto e32 · Android 11 · Google Chrome 94.0.4606.85", foto 360 x 640 com SHA-256
631EDB54… sem EXIF pelo leitor interno, nota de rastreabilidade sobre o autor do template.

Banco Master (CCB 27766845): INT4 (55 s entre criação e carimbo), IMG2 (foto 379 x 240
repetida nas páginas 1 e 10, SHA-256 9B4C44E5…), BIO2, tudo pelo leitor interno, sem
Poppler.

## Como testar

```bash
cd backend
JWT_SECRET=qualquer npx vitest run tests/engine
```

Suítes novas: `pdfImagensInterno`, `metadadosDatas`, `dispositivo`, `grauEFaixa`,
`comprovanteTerceiro`, `imageReuse`. A suíte inteira passa exceto o que já dependia de
ambiente (Prisma gerado, Redis, `pdftoppm`).

Para ver o laudo inteiro num PDF real:

```bash
node scripts/gerarLaudoTeste.mjs "/caminho/dossie.pdf" "Endereço do cliente" --saida=laudo.pdf
```

## O que fica para a próxima rodada

1. Validação de assinatura ICP-Brasil no verificador do ITI e cadeia até a AC-Raiz, com
   revogação na data (hoje só `pdfsig`).
2. Leitura completa do EXIF (aparelho, data, GPS) quando existir, e hash perceptual para
   quase duplicata de fotografia.
3. ELA e detecção de clone na fotografia e no documento de identidade; comparação facial
   1:1 assistida.
4. Faixa de IP por base de ASN em vez de nome do titular.
5. Âncora com página e trecho para os achados antigos da extração (hoje só os novos e os
   de comprovante trazem âncora; os demais recebem grau pelo catálogo).
6. Índice em `analyses` para a busca de reúso de imagem quando a tabela crescer
   (`CREATE INDEX ... ON analyses USING gin ((result->>'text') gin_trgm_ops)` ou coluna
   própria com os hashes).
