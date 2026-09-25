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

## Segunda rodada (22/09, noite): o que o laudo FD-20260923 do dossiê Irailzo mostrou

O primeiro laudo gerado no servidor com o motor novo (v16, 22:05) trouxe quatro defeitos, todos
corrigidos aqui:

1. **IMG6 acusava o próprio dossiê.** A busca de reúso encontrava as nove análises anteriores do
   mesmo PDF (mesmo SHA-256 ABC18B73E5…, mesmo contrato 6046501059) e imprimia "mesma fotografia
   em outro dossiê", crítico e constatado. Agora a consulta exclui análises com o mesmo SHA-256 do
   arquivo, o serviço descarta outra cópia do mesmo número de contrato, e várias análises do mesmo
   laudo anterior contam uma vez. O achado só sai quando a foto aparece em contratação diversa.
2. **Placar do sumário contradizia o § 6** (10 indícios contra 4). O placar era gravado sobre a
   lista inteira e o sumário depois cortava o eixo financeiro e os achados de distância residencial
   sem recontar. `sanearSumario` (backend e frontend) reconta os graus sobre a projeção que o corpo
   imprime.
3. **Quesito 2 afirmava "incompatibilidade espacial" a 23 km** que o § 5 classificava como
   compatível. O quesito agora recebe o nível do confronto IP × residência e só é montado em
   divergência relevante ou grave. Sem o nível (análises antigas), vale a regra anterior.
4. **A lista de ferramental citava o que o sistema não usa** (MaxMind GeoIP2, QPDF, ExifTool,
   MD5). Passou a listar o que roda de fato: Node crypto, pdf.js/pdf-parse, Poppler quando
   instalado e o leitor interno, sharp/libvips, RDAP, RIPEstat, ipapi.co, ipwho.is, Nominatim,
   awesomeapi-cep.

Também: o texto do PAG1 dizia "estado é de indício" com grau CONSTATADO; agora separa o fato
(numeração constatada no arquivo) da leitura (indício).

Ponto que fica para o Ronney decidir: LIB1 ("ausência de comprovante de transferência") e o
quesito "Comprovação do crédito liberado" tratam de o dinheiro ter chegado ou não à conta, e a
regra dele de 22/09 é que o laudo trata só dos dados técnicos do contrato. Retirar os dois é uma
linha no motor e ajuste em quatro testes de regressão; não foi feito sem a palavra dele.

## Terceira rodada (25/09): os dois laudos da Eunice x Banco Master

Os laudos FD-20260925-C5FEC93785 (CCB 27766845) e FD-20260925-C58D1C00C6 (CCB 66637168)
saíram do servidor com dois defeitos novos, corrigidos aqui:

1. **A arte do cartão Credcesta virou "fotografia biométrica".** A imagem de 379 x 240 (vermelho
   chapado, chip, logotipo Visa) passa no crivo por dimensão e aparece duas vezes em cada dossiê
   e nos dois contratos. O laudo imprimiu IMG2 crítico (repetida) e IMG6 crítico (mesma foto em
   outro dossiê) sobre um desenho. `engine/aparenciaFoto.js` mede tom de pele (regra RGB de Kovac
   e YCbCr de Chai e Ngan, em 48 x 48) e cor chapada de marca; selfies reais deram 28 % a 37 %
   de pele, o cartão 6,6 % de pele com 83 % de cor chapada. Abaixo de 10 % de pele, ou abaixo
   de 20 % com mais de 45 % de cor chapada, a imagem vira "ilustração/cartão do template" e sai
   do IMG2, do IMG6, do BIO2 e da ELA. Vale nos dois caminhos (Poppler e leitor interno).
2. **A cliente de Amparo/SP saiu domiciliada "do Rio de Janeiro", UF "do".** A primeira
   ocorrência de "cidade" na CCB do Master é a sede do credor ("com sede na cidade do Rio de
   Janeiro, Estado do Rio de Janeiro"), e a regex de UF com `/i` lia "do" como sigla. Agora o
   valor de cidade que começa por preposição, é rótulo ou endereço institucional é descartado e
   o motor segue para a próxima ocorrência (o campo "Cidade:" do quadro do cliente); a sigla da
   UF só aceita maiúsculas; e "Bairro: Cidade: Estado:" em sequência é reconhecido como rótulo.
   Com isso somem a "divergência cadastral" ALTA e constatada contra a residência de Amparo e o
   "confronto não aferido" do segundo laudo.

Também: `sanearSumario` já recontava os graus; o placar dos dois laudos batia com o § 6 só por
coincidência de cortes.

Ponto de desenho para o Ronney decidir: o "Índice de anomalia forense" da capa mede só
distância geográfica (`utils/forensicScore.js`). Um laudo com IMG2 e IMG6 críticos saiu com
"4/100 · baixa". Ou o rótulo passa a dizer "índice geográfico", ou o índice passa a pesar os
achados constatados.

## Quarta rodada (25/09): regimes de autorização do INSS e ciclo de validação

Implementado o plano `docs/superpowers/plans/2026-09-25-regimes-autorizacao-inss.md` (tarefas 1 a
11), com duas travas a mais que o plano, pela regra do escritório de nunca afirmar norma não
conferida: INS2 (demonstrativo prévio) só sai como achado quando
`DISPOSITIVOS_IN138.DEMONSTRATIVO_PREVIO.conferido` for verdadeiro; até lá a ausência entra como
diligência. INS1 (correspondente de outra UF) não afirma o dispositivo enquanto
`LOCAL_DOMICILIO.conferido` for falso. A tarefa 12 (trava jurídica) fica com o escritório: conferir no
DOU a IN 138 (art. 5º, VIII e § 9º), a norma de maio de 2026 e a IN 213/2026 e virar os flags em
`engine/regimeInss.js`.

Ciclo de validação com laudos reais (Irailzo, Eunice, C6 Maria de Lourdes, C6 INSS 2024, Master
MFacil, Pan 2017, Agibank, Bradesco 2021, C6 2024) e verificador automático
(`undefined`, `null`, travessão, placar contra § 6, rótulo como valor, quesito contra confronto
compatível). Corrigido no ciclo: o campo "Fonte Pagadora:" decide o produto antes da prosa das
condições gerais (a CCB do Master da servidora do GOV SP saía como INSS); foto sem página não
imprime "pág. null"; IMG2 da mesma selfie reimpressa em folhas distintas é MÉDIO; ícones de até
15 mil pixels são template; travessão fora do texto da ELA. Levantamento dos 65 dossiês da pasta
de testes: 39 com texto, 26 exigem OCR (pdftoppm); nenhum contrato cai no regime Meu INSS ou na
IN 213 até setembro de 2026, todos os INSS estão na IN 138 ou na IN 28/2008.

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
