# Motor pericial v2 e réplica processual

Registro das mudanças e melhorias feitas no ForenseDoc SaaS com a migração do backend de perícia do projeto `motor-de-geracao`.

- **Data:** 16/09/2026
- **Branch:** `feat/motor-pericial-v2` (ainda sem commit)
- **Escopo:** motor de geração do laudo de análise forense e nova funcionalidade de réplica processual. Autenticação, créditos, planos, cobrança, notificações e administração não foram alterados.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Melhorias no laudo de análise forense](#2-melhorias-no-laudo-de-análise-forense)
3. [Nova funcionalidade: réplica processual](#3-nova-funcionalidade-réplica-processual)
4. [Correções de qualidade](#4-correções-de-qualidade)
5. [Arquitetura e arquivos](#5-arquitetura-e-arquivos)
6. [API](#6-api)
7. [Dados persistidos](#7-dados-persistidos)
8. [Infraestrutura e configuração](#8-infraestrutura-e-configuração)
9. [Testes](#9-testes)
10. [Decisões pendentes de validação](#10-decisões-pendentes-de-validação)
11. [Limitações conhecidas](#11-limitações-conhecidas)

---

## 1. Visão geral

O motor de geração novo existia como aplicação local, sem autenticação, fila ou isolamento entre escritórios, com toda a regra pericial concentrada num `server.js` de 2.580 linhas. Essa regra foi levada para o SaaS em módulos próprios (`backend/src/engine/`) e ligada ao pipeline que já existia: upload autenticado, débito de crédito, fila BullMQ, worker, resultado persistido no banco e laudo em PDF gerado pelo servidor.

Resultado em números:

| Item | Antes | Depois |
|---|---|---|
| Testes do backend (vitest) | 316 | 444 |
| Testes do frontend | 49 | 65 |
| Testes do Motor de Réplicas (Python) | não existia | 16 |
| Seções do laudo | §§ 0 a 9 | §§ 0 a 9, mais §§ 1.2, 2.1, 4.2, 6.1 e sumário executivo |

---

## 2. Melhorias no laudo de análise forense

### 2.1 Leitura do documento

- **Texto com colunas preservadas.** O PDF passa a ser lido com `pdftotext -layout` (Poppler), com o `pdf-parse` como reserva. Tabelas de qualificação ("Nome  CPF  Data Nascimento" com valores na linha seguinte) deixam de ser achatadas.
- **OCR do início e do fim.** Em documentos maiores que `OCR_MAX_PAGES`, o OCR lê 60% das páginas no início (qualificação e quadro da operação) e 40% no fim (assinatura e trilha). Antes, lia só as primeiras.
- **Releitura das páginas finais.** As duas últimas páginas, onde ficam IP, porta e carimbos de tempo, são relidas a 240 DPI ou mais. O orçamento de tempo do OCR foi ajustado para incluir essa releitura.
- **Rodapé do PJe removido** antes da extração, para que "Assinado eletronicamente por... Num. 123 - Pág. 4" não contamine nome e datas.

### 2.2 Extração estruturada

- **Layouts dedicados por instituição:** Bradesco (consignado INSS), Banco do Brasil (renegociação CDC), Agibank e Facta (cartão consignado de benefício RMC), além do layout genérico.
- **Instituição pela raiz do CNPJ**, com código COMPE, em vez de número solto lido perto de "Banco:".
- **Modalidade específica:** RMC, RCC, empréstimo consignado, renegociação CDC, FGTS. Campos de empréstimo (valor contratado, parcela, número de parcelas) não são preenchidos para cartão consignado, que ganha quadro próprio (limite, saque, desconto mensal, prazo de liquidação, tarifa, seguro, forma da fatura).
- **Dados econômicos complementares:** valor liberado, novos recursos, IOF financiado, somatório das parcelas, saldo refinanciado, prazo em dias, carência, taxa anual calculada quando o campo está em branco, tipo de operação, credor original, agência e conta de recebimento, correspondente bancário.
- **Data do contrato validada** contra a data de nascimento: uma data igual à de nascimento, anterior aos 18 anos do contratante, anterior a 2000 ou futura é descartada com nota.
- **Qualificação do contratante** com origem de cada campo (`cliente.origens`): extraído, inferido de outro quadro ou descartado, com o motivo.

### 2.3 Aferição matemática (§ 2.1)

Confere, com o selo CONFERE / NÃO CONFERE:

- prazo declarado contra as datas do contrato e do último vencimento;
- somatório das parcelas contra número × valor da parcela;
- composição do financiado (liberado + IOF);
- valor presente das parcelas pela taxa declarada;
- CET anual contra o CET mensal capitalizado;
- CET implícito no fluxo de pagamentos, com indicação de subdeclaração quando o CET declarado é menor que o implícito ou que a taxa nominal.

### 2.4 Assinatura digital, proveniência e imagens (§ 1.2)

- **Catálogo do PDF:** presença de AcroForm, SigFlags, campos de assinatura (nome, visível ou invisível, SubFilter, data declarada, ByteRange) e número de atualizações incrementais.
- **Validação criptográfica por `pdfsig`:** signatário, data, algoritmo, validade da assinatura e do certificado, percentual do documento coberto.
- **Alertas de assinatura:** S1 certificado expirado, S2 divergência de resumo (digest mismatch), S3 assinatura parcial, S4 signatário é a própria instituição, S5 assinatura do emissor anterior ao aceite do contratante, S6 campo com nome de desenvolvimento, S7 atualizações incrementais múltiplas, S8 carimbo de tempo RFC 3161 não confirmado.
- **Proveniência do arquivo:** nativo provável, re-renderizado por sistema processual (PJe), reimpressão posterior à contratação ou arquivo derivado. Quando o arquivo não permite aferir assinatura e metadados, o laudo diz isso em vez de afirmar ausência.
- **Inventário de imagens por `pdfimages`:** total, classificação (logotipo, linha gráfica, fotografia ou biometria provável), SHA-256 de cada imagem e grupos de imagens idênticas. Alertas IMG0 a IMG5, entre eles a mesma imagem usada como identificação e prova de vida.
- **Elegibilidade do documento:** detecta peça judicial (endereçamento ao juízo, assinatura com OAB, cabeçalho de tribunal, capa do PJe) apresentada como se fosse contrato.

### 2.5 Trilha da contratação (§ 4.2)

- Forma de aceite, telefone do aceite, dispositivo (sistema, navegador e modelo, quando identificável).
- Linha do tempo do aceite com duração total do fluxo e intervalo até o primeiro aceite.
- Histórico de ações do dossiê (link aberto, termo aceito, selfie, processo finalizado) com data, hora, IP, porta e coordenada de cada evento, dispersão das coordenadas e alerta de carimbos de tempo que não se conciliam com o horário da assinatura.
- Independência da plataforma de assinatura: indica quando o domínio do validador pertence ao próprio credor.
- Placar da cadeia de custódia por itens eliminatórios (hash declarado, provedor verificável, carimbo de tempo independente, registro de preservação) e auxiliares.

### 2.6 Achados de irregularidade (§ 6)

Cada achado passa a ter código, gravidade, título e texto. Principais códigos:

| Código | Achado |
|---|---|
| CET1 | Demonstrativo de cálculo do CET ausente do instrumento |
| FIN1, FIN2 | Taxa anual em branco; valor liberado ao cliente em branco |
| FIN3 | Carência prolongada entre contratação e primeiro vencimento |
| FIN4 | Credor original preenchido com o nome do consumidor |
| TRB1, TRB2 | IOF que exige demonstrativo da base; tributos declarados como 0,00% |
| INT1 | Código de autenticação declarado e inverificável |
| INT2 | Arquivo apresentado é reimpressão posterior à contratação |
| CAD1, CAD2, CAD3 | Qualificação incompleta; benefício não identificado; Termo de Consentimento com número de benefício divergente |
| AUT1 | Telefone do aceite diverge do cadastro |
| LOG1 | Ausência de rastros técnicos da contratação |
| CUS1 | Itens eliminatórios da cadeia de custódia não satisfeitos |
| TML1, TML2 | Fluxo concluído em poucos minutos; aceite poucos segundos após o acesso |
| BIO1 | Facematch interno sem validação contra base pública |
| CCB1 | CCB referida na trilha, mas ausente do arquivo |
| RMC1, FAT1, TAR1, IDA1 | Cartão consignado: desconto projetado muito superior ao saque; fatura só eletrônica para idoso de zona rural; tarifa de emissão; contratante idoso com prazo longo |
| TET1, TET2 | Taxa acima do teto do CNPS vigente na data; taxa exatamente no teto |
| IMG0 a IMG5 | Achados do inventário de imagens |

Laudos antigos, que só têm a lista em texto (`evidencias_irregularidade`), continuam sendo exibidos como antes.

### 2.7 Geolocalização e IP (§ 5)

- **Geocodificação por CEP em duas vias:** AwesomeAPI (já existente) e, na falta de coordenada, ViaCEP para obter município e UF oficiais e geocodificar o centro do município. O resultado é marcado como precisão de cidade.
- **Resultado do Nominatim validado:** sem cidade reconhecível no endereço, o resultado só é aceito se UF, CEP ou município do texto aparecerem no endereço devolvido. Antes era aceito às cegas.
- **Município do GPS declarado** por geocodificação reversa, exibido no § 5 e usado no sumário para apontar ato praticado em município diverso do domicílio.
- **Histórico do IP na data do ato (RIPEstat).** Se o bloco mudou de detentor depois da contratação, ou pertence a marketplace de aluguel de IPv4, a distância continua visível, mas o veredito ("DIVERGÊNCIA GRAVE") é substituído pela nota de proveniência do endereço.
- **Classe do IP:** público, CGNAT, privado, loopback ou link-local. Faixas não roteáveis não são enviadas aos provedores de geolocalização, e o laudo explica o motivo.

### 2.8 Confronto com o processo judicial (§ 6.1)

Depois da análise concluída, o operador pode anexar o PDF do processo. O sistema procura nele número do contrato, nome, CPF, banco, benefício, forma de aceite, valores, taxas, CET e vencimentos lidos do contrato, e aponta divergências com o trecho de origem. Exemplos: valor tratado como total na petição que coincide com o saldo refinanciado; valor do comprovante de TED diferente do valor liberado; CET do demonstrativo diferente do CET da cédula; sentença de improcedência localizada.

O confronto roda na fila, não consome crédito, o PDF do processo é apagado ao fim da leitura e a tela avisa quando houve revisão de campos depois do confronto.

### 2.9 Sumário executivo de irregularidades

Ao final do laudo (tela, histórico e PDF):

- grau de suspeição técnica (BAIXA, MODERADA, ALTA, CRÍTICA) com a justificativa;
- placar de gravidade com os achados ordenados;
- escala logarítmica de distâncias GPS × IP;
- triagem dos IPs entre acesso provável, servidor do banco, CDN e infraestrutura;
- síntese do confronto geográfico;
- até sete diligências recomendadas (logs brutos, titular da conexão, demonstrativo do CET, payload original assinado, entre outras).

O sumário é calculado no servidor, persistido com o laudo e recalculado sempre que o operador corrige a coordenada ou revisa campos.

### 2.10 Laudo em PDF gerado pelo servidor

Novas seções no PDF, na mesma ordem da tela: § 1.2, § 2.1, § 4.2, § 6.1 e sumário executivo. O § 5.3 passa a mostrar o registro do bloco de IP na data do ato e o § 6 os achados com código e gravidade.

---

## 3. Nova funcionalidade: réplica processual

### 3.1 Fluxo

1. Menu **Réplica Processual** (`/dashboard/replica`).
2. O advogado anexa os autos: petição inicial, contestação e documentos, ou o caderno completo do PJe. Formatos PDF, PNG, JPG e TXT, com OCR opcional.
3. A leitura roda na fila. O Motor de Réplicas separa o caderno do PJe em documentos lógicos, classifica cada peça e cruza o conteúdo com o Caderno de Réplicas (2ª edição, 15 cenários).
4. A tela mostra:
   - documentos classificados, com origem, páginas do caderno e hash;
   - verificações que exigem o arquivo bancário nativo e não foram executadas;
   - achados para conferência, com gravidade, arquivo, trecho e pedido cabível;
   - leitura dos autos por campo, com grau de confiança e evidências;
   - preliminares suscitadas na contestação.
5. O advogado escolhe o cenário (indicado automaticamente ou manual), pode corrigir os dados do caso e declara que conferiu as evidências.
6. A minuta é montada, com a contagem de pendências entre colchetes, e pode ser copiada ou baixada em .doc. Toda minuta sai marcada como não liberada para protocolo.

As réplicas recentes ficam listadas na mesma tela e podem ser reabertas ou apagadas.

### 3.2 Garantias

- A minuta é montada a partir da análise guardada no servidor. Do navegador só entram a letra do cenário, a confirmação e correções curtas dos dados do caso (chaves validadas, textos limitados a 1.000 caracteres).
- Sem a confirmação de conferência humana, a rota recusa a montagem.
- Quando o Caderno exige documentos que não foram enviados (por exemplo, menos de três peças), a recusa do motor é devolvida ao usuário com a mensagem dele.
- Isolamento por escritório em toda leitura, montagem e exclusão.
- Registro no log de auditoria: `replica_started`, `replica_draft_built`, `replica_deleted`, `process_comparison_started`. Só identificadores e tamanhos, nunca conteúdo.

### 3.3 Limites

| Limite | Padrão | Variável |
|---|---|---|
| Arquivos por réplica | 30 | `REPLICA_MAX_FILES` |
| Tamanho por arquivo | 30 MB | `REPLICA_MAX_FILE_MB` |
| Tamanho total | 80 MB | `REPLICA_MAX_TOTAL_MB` |
| Retenção do resultado e da minuta | 168 horas | `REPLICA_RETENTION_HOURS` |

A extensão de cada arquivo é conferida contra o conteúdo (assinatura de PDF, PNG e JPG).

---

## 4. Correções de qualidade

### 4.1 Correções do SaaS preservadas na mescla

Os padrões genéricos do motor novo reintroduziam defeitos que o SaaS já tinha corrigido com documento real. A regra adotada foi: layout dedicado do motor tem prioridade; valor vindo de padrão genérico só é aceito se passar pelo critério já validado no SaaS (`engine/salvaguardas.js`).

| Defeito que voltaria | Salvaguarda |
|---|---|
| Contratante chamado "Do Cliente", nome da mãe ou do consultor como contratante | Nome pelo critério de forma de nome de pessoa |
| Número do contrato igual a "Documento" ou "contratada" | Exige pelo menos quatro dígitos |
| Coordenada com três casas decimais ignorada | Critério de plausibilidade geográfica no território brasileiro |
| Latitude e longitude trocadas no rótulo combinado | Rótulo "Latitude e Longitude" tem precedência |
| IPv6 com porta perdido; versão de aplicativo lida como IP | Extrator do SaaS somado ao do motor, sem readmitir número de versão |

### 4.2 Defeitos do motor corrigidos

| Defeito | Efeito no laudo | Correção |
|---|---|---|
| Catálogo do PDF localizado pelo primeiro objeto do arquivo | Em PDF assinado com atualização incremental, afirmava AcroForm ausente e nenhum campo de assinatura | Catálogo pelo `/Root` do trailer, com busca do objeto dono de `/Type /Catalog` como reserva |
| Endereço da estipulante do seguro lido como residência | No dossiê C6, a sede do banco em São Paulo virava residência de contratante de Manaquiri/AM, e todas as distâncias do § 5 eram medidas a partir dela | Endereço em contexto de CNPJ, estipulante, seguradora ou corretora é descartado, com registro do motivo |
| Rótulo de tabela lido como valor | Cidade do contratante igual a "Estado" | Leitura de tabela por alinhamento de coluna |
| Carência negativa | "Carência: -27 dias" | Campo omitido e nota de conferência das datas (`contrato.datas_nota`) |
| Veredito do confronto sobrescrevendo o estado do job | A tela ficaria esperando o confronto indefinidamente | Veredito gravado em `processComparison.resultado` |
| Evidências das preliminares com nome da cópia temporária | Tela mostraria "002-contestacao.txt" | Nome original do documento |
| Travessões no texto do laudo | Contrário ao padrão de redação do escritório | Substituídos por vírgula ou dois-pontos |

### 4.3 Casos de regressão atualizados

| Caso | Campo | Antes | Depois | Motivo |
|---|---|---|---|---|
| `banco-c6-rcc-ipv6` | `contrato.numero` | 900112233 | 1234567890 | O valor antigo é o número da proposta do seguro; o novo é o da CCB |
| `banco-pan-cartao-consignado` | `contrato.modalidade` | Cartão consignado | RMC | Classificação específica; o produto ganhou campo próprio |

O motivo ficou registrado no campo `revisao` de cada JSON.

---

## 5. Arquitetura e arquivos

### 5.1 Pipeline da análise

```
POST /api/analyze (inalterado: validação, crédito, slot, fila)
  └─ worker: jobs/analysisWorker.js
       ├─ services/ocrService.js      texto -layout, OCR início/fim, releitura final
       ├─ services/pdfService.js      metadados + engine/pdfForensics.js
       ├─ engine/analisarDocumento.js extração, proveniência, imagens, alertas S5, INT2
       ├─ services/geoEnrichmentService.js  IP (classe, histórico), residência, município do GPS
       ├─ reports/custodyChain.js     (inalterado)
       └─ services/analysisRecompute.js  sumário executivo
```

### 5.2 Arquivos novos

**Motor pericial (`backend/src/engine/`)**

| Arquivo | Conteúdo |
|---|---|
| `analisarDocumento.js` | Orquestração da regra pericial chamada pelo worker |
| `extraction.js` | Extração estruturada, layouts por banco, aferição matemática, achados |
| `pdfForensics.js` | Proveniência, catálogo, `pdfsig`, `pdfimages`, metadados |
| `processComparison.js` | Confronto contrato × processo |
| `irregularitySummary.js` | Sumário executivo |
| `salvaguardas.js` | Mescla com as correções do SaaS e salvaguardas novas |
| `format.js` | Datas, valores, nomes |
| `audit.js`, `trilhaAnalysis.js` | Trilha de ações e linha do tempo do aceite |
| `factaCartao.js`, `bankRegistry.js`, `cnpsRateCeiling.js` | Layout Facta, instituição por CNPJ, teto do CNPS |
| `documentEligibility.js`, `pjeText.js` | Elegibilidade do documento, rodapé do PJe |
| `geo.js`, `geocodeCascade.js`, `network.js`, `ipHistory.js`, `numberParsing.js` | Coordenadas, validação de geocodificação, IP, histórico de IP, números |
| `replicas/` | Motor de Réplicas: ponte Node/Python, seletor de documentos, Caderno de Réplicas e testes Python |

**Backend (demais)**

| Arquivo | Conteúdo |
|---|---|
| `controllers/processComparisonController.js` | Rota do confronto com o processo |
| `controllers/replicaController.js` | Rotas da réplica |
| `routes/replicaRoutes.js` | Registro das rotas da réplica |
| `jobs/processComparisonWorker.js`, `jobs/replicaWorker.js` | Jobs da fila |
| `jobs/purgeMotorUploads.js` | Varredura de arquivos transitórios órfãos |
| `services/ipHistoryService.js` | Consulta ao RIPEstat com cache |
| `services/replicaStore.js`, `services/replicaValidation.js` | Armazenamento com expiração e validação dos autos |
| `utils/uploadRoutes.js` | Rotas de upload fora do parser global de 1 MB |

**Frontend**

| Arquivo | Conteúdo |
|---|---|
| `pages/Replica.jsx` | Tela da réplica processual |
| `components/report/AssinaturaDigital.jsx` | § 1.2 |
| `components/report/AfericaoMatematica.jsx` | § 2.1 |
| `components/report/TrilhaContratacao.jsx` | § 4.2 |
| `components/report/AchadosIrregularidade.jsx` | § 6 |
| `components/report/ConfrontoProcesso.jsx` | § 6.1 |
| `components/report/SumarioExecutivo.jsx` | Sumário executivo |
| `utils/replicaPresentation.js` | Apresentação dos documentos da réplica |

### 5.3 Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `backend/server.js` | Rotas de upload novas fora do parser global |
| `backend/src/routes/index.js` | Rota do confronto e montagem de `/replicas` |
| `backend/src/worker.js` | Handlers `compare-process`, `replica-analyze` e cron `purge-motor-uploads` |
| `backend/src/jobs/analysisWorker.js` | Usa `engine/analisarDocumento.js`; persiste campos novos e sumário |
| `backend/src/services/extractionService.js` | Passa a reexportar a extração do motor |
| `backend/src/services/pdfService.js` | Metadados do motor; leitura com `pdftotext -layout` |
| `backend/src/services/ocrService.js` | Faixas início/fim, releitura final, orçamento de tempo |
| `backend/src/services/geocodingService.js` | ViaCEP, validação do Nominatim, geocodificação reversa |
| `backend/src/services/nominatimClient.js` | URL de geocodificação reversa |
| `backend/src/services/geoEnrichmentService.js` | Classe e histórico do IP, município do GPS |
| `backend/src/services/analysisRecompute.js` | Supressão por histórico e recálculo do sumário |
| `backend/src/utils/geoDivergence.js` | `aplicarHistoricoDoIp` |
| `backend/src/services/reportPdfService.js` | Seções novas do PDF |
| `frontend/src/pages/Analyze.jsx` | Seções novas do laudo |
| `frontend/src/pages/History.jsx` | Achados estruturados e sumário no detalhe da análise |
| `frontend/src/components/report/IpTrace.jsx` | Classe do IP e registro na data do ato |
| `frontend/src/App.jsx`, `components/Layout/DashboardLayout.jsx` | Rota e item de menu da réplica |
| `backend/Dockerfile`, `nginx/conf.d/forensedoc.conf`, `backend/.env.example`, `backend/package.json`, `.gitignore` | Infraestrutura (seção 8) |

---

## 6. API

### 6.1 Rotas novas

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/analyses/:id/process-comparison` | `{ pdfBase64, filename }` | `202 { analysisId, status: "PROCESSING" }` |
| POST | `/api/replicas` | `{ documents: [{ name, base64 }], ocr }` | `202 { replicaId, status: "PROCESSING" }` |
| GET | `/api/replicas` | | `{ replicas: [...], retentionHours }` |
| GET | `/api/replicas/scenarios` | | `{ engine, scenarios: [{ letra, titulo }] }` |
| GET | `/api/replicas/:id` | | `{ replica }` |
| POST | `/api/replicas/:id/draft` | `{ letter, reviewConfirmed, caseData?, preliminaries? }` | `{ draft }` |
| DELETE | `/api/replicas/:id` | | `204` |

Todas exigem autenticação. As rotas que recebem arquivo usam o limitador de vazão de análises do plano; as demais, o limitador por escritório.

### 6.2 Respostas de erro

| Código | Situação |
|---|---|
| 400 | Arquivo inválido, extensão não permitida, conteúdo que não bate com a extensão, conferência humana não declarada, cenário não selecionado |
| 404 | Análise ou réplica inexistente, expirada ou de outro escritório |
| 409 | Análise não concluída, confronto já em andamento, leitura dos autos não concluída, vagas simultâneas do plano ocupadas |
| 422 | Motor de Réplicas recusou a montagem por pré-requisito dos autos |
| 503 | Motor de Réplicas indisponível no servidor (Python ausente) |

### 6.3 Rotas existentes

`POST /api/analyze`, `GET /api/analyses/:id/result`, revisão de campos e correção de coordenada mantêm contrato e comportamento. O resultado devolvido ganhou campos (seção 7), sem remover nenhum.

---

## 7. Dados persistidos

Nenhuma tabela ou coluna do banco foi criada ou alterada. As mudanças estão dentro do JSON `Analysis.result`, como superconjunto do formato anterior.

**Novos campos em `result`:** `eligibility`, `engine`, `reportId`, `ocrPageNumbers`, `ocrRefinementPages`, `sumarioIrregularidades`, `processComparison`.

**Novos campos no extraído (`result.text`):** `achados_irregularidade`, `afericao_matematica`, `imagens_pdf`, `trilha_acesso`, `rodape_pje`, `cadeia_custodia.placar` e `eliminatorios`, `cliente.origens`, `ips[].classe` e `ordem`, além dos campos econômicos, de cartão e de trilha descritos na seção 2.

**Novos campos em `result.metadata`:** `digitalSignature`, `cryptographicSignatureStatus`, `cryptographicSignatureReason`, `metadataAnalysisStatus`, `sourceProvenance`.

**Novos campos em `result.ipAnalysis[]`:** `historico`. **Em `result.contractGeo`:** `municipio`, `uf`, `municipioDisplay`.

**Réplicas:** Redis, chaves `replica:<tenant>:<id>` e índice `replicas:<tenant>`, com expiração.

**Arquivos transitórios:** PDF do processo (`<tenant>/<dia>/<análise>-processo-<rand>.pdf`) e autos (`<tenant>/<dia>/replicas/<id>/`), apagados ao fim do job. O cron `purge-motor-uploads` remove, de hora em hora, os que tiverem mais de 24 horas.

---

## 8. Infraestrutura e configuração

### 8.1 Dependências de sistema

| Dependência | Uso | Situação |
|---|---|---|
| `pdftotext`, `pdfsig`, `pdfimages`, `pdftoppm` | Leitura, validação de assinatura, imagens, OCR | Já instalados pelo `poppler-utils` |
| `python3` | Motor de Réplicas | Adicionado ao `backend/Dockerfile` |
| `tesseract` | OCR da réplica | Já instalado |

Sem `pdfsig` ou `pdfimages`, o laudo sai normalmente e informa que a verificação não pôde ser executada.

### 8.2 Variáveis de ambiente (todas opcionais)

| Variável | Padrão | Uso |
|---|---|---|
| `PDFTOTEXT_PATH`, `PDFSIG_PATH`, `PDFIMAGES_PATH` | PATH | Caminho dos utilitários do Poppler |
| `PYTHON_PATH` | `python3` | Interpretador do Motor de Réplicas |
| `REPLICA_MAX_FILES` | 30 | Arquivos por réplica |
| `REPLICA_MAX_FILE_MB` | `MAX_PDF_MB` ou 30 | Tamanho por arquivo |
| `REPLICA_MAX_TOTAL_MB` | 80 | Tamanho total dos autos |
| `REPLICA_RETENTION_HOURS` | 168 | Retenção do resultado da réplica |
| `MOTOR_UPLOAD_MAX_AGE_HOURS` | 24 | Idade para remover arquivos transitórios órfãos |

### 8.3 Outros ajustes

- **nginx:** `client_max_body_size 120m` apenas em `POST /api/replicas`. As demais rotas seguem com 50 MB.
- **Parser de corpo:** as rotas de upload novas foram incluídas na exceção ao limite global de 1 MB (`utils/uploadRoutes.js`).
- **Consultas externas novas, com cache no Redis:** ViaCEP (365 dias), geocodificação reversa (365 dias, coordenada arredondada a cerca de 100 m) e RIPEstat (30 dias, por IP e dia do ato).
- **Script:** `npm run test:replicas` no backend.
- **`.gitignore`:** `__pycache__/`.

---

## 9. Testes

### 9.1 Como rodar

```bash
cd backend && npm test               # vitest
cd backend && npm run test:replicas  # Motor de Réplicas (Python)
cd frontend && npm test && npm run build
```

### 9.2 Cobertura adicionada

| Arquivo | O que protege |
|---|---|
| `backend/tests/engine/*.test.js` | Os 67 testes do motor de geração, convertidos para vitest, e 8 do sumário executivo |
| `backend/tests/motorPericial.test.js` | Mescla (nome, IPs, coordenadas), tabela em colunas, endereço institucional, faixas de OCR, `analisarDocumento` com PDF real, validação dos autos, histórico de IP, catálogo de assinaturas |
| `backend/tests/motorPericialControllers.test.js` | Isolamento entre escritórios, recusa antes de ocupar vaga, trava de conferência humana, minuta a partir da análise guardada, erro 422 |
| `backend/tests/reportPdfMotor.test.js` | PDF com todas as seções novas e PDF de laudo antigo |
| `backend/tests/uploadRoutes.test.js` | Exceção ao parser global só para as rotas de upload |
| `backend/tests/purgeMotorUploads.test.js` | Remoção de órfãos sem tocar no dossiê da análise |
| `frontend/src/tests/motorPericialUi.test.jsx` | Renderização das seções novas e da tela de réplica com dados reais do motor |
| `frontend/src/tests/replicaPresentation.test.js` | Apresentação dos documentos da réplica |

### 9.3 Resultado

| Suíte | Resultado |
|---|---|
| Backend | 444 passando |
| Motor de Réplicas | 16 passando |
| Frontend | 65 passando, build ok |

Validação manual: pipeline completo sobre um dossiê C6 real de 27 páginas (1,6 s sem OCR) e conferência visual do PDF do laudo, página a página.

`tests/accountLockout.test.js` falha de forma intermitente também no código anterior à migração; não tem relação com estas mudanças.

### 9.4 Não validado

- Sistema completo em execução, com Postgres, fila e navegador.
- Chamadas reais a ViaCEP, RIPEstat e geocodificação reversa.
- Build da imagem Docker com `python3`.

---

## Laudo idêntico ao do motor de geração

Comparação feita com `documentação/doc_teste/dossiê.pdf` gerado nos dois sistemas (motor local e SaaS), com o mesmo endereço de referência. Os dados já coincidiam, porque o backend do motor tinha sido portado; a diferença estava no documento, que o motor monta no navegador.

**O que mudou**

- O laudo do SaaS passou a ser o renderizador do motor (`frontend/src/laudo/`), alimentado pelo resultado persistido: capa com protocolo, §§ 1 a 10 com todas as linhas, placar da cadeia de custódia por itens eliminatórios, § 4.1 com linha do tempo e dispersão das coordenadas, § 4.2 com inventário de imagens e grupos repetidos, mapas cartográficos reais com escala e norte, § 7 de confronto com o processo, § 8 com achados agrupados em inconsistências, lacunas probatórias e contexto econômico, sumário executivo em duas páginas.
- O PDF é o do motor (`exportarLaudoPdf.js`): captura do laudo em modo claro, A4 com cabeçalho e rodapé, numeração, sem cortar blocos, mapa em folha exclusiva e sumário em páginas próprias. No dossiê de teste, os dois PDFs têm 23 páginas.
- Página única do laudo em `/dashboard/laudo/:id`. A nova análise abre essa página ao concluir, e o histórico passou a ter o botão "Abrir laudo e PDF". Revisão de campos, coordenada confirmada e envio do processo ficam acima do documento, fora da captura.
- `GET /api/map-tile/:z/:x/:y.png`: blocos cartográficos do mapa, com cache no Redis, Geoapify quando `GEOAPIFY_KEY` existe e OpenStreetMap só como reserva. Rota pública porque `<img>` não envia token; nenhum dado do laudo trafega.
- Removidos por falta de uso: o laudo antigo de `Analyze.jsx`, `IpTrace.jsx`, `CadeiaCustodia.jsx`, `reportDownload.js` e os componentes de seção criados na primeira migração. O endpoint do PDF gerado no servidor (`GET /api/analyses/:id/pdf`) continua existindo, mas a interface não o usa mais.

**Mantido do SaaS, dentro do laudo do motor**

- Dados com as correções de extração (número do contrato, endereço, cidade, carência, e as novas: credor "(iii)", espécie de benefício com trecho de cláusula e código do banco da conta de crédito tratado como banco do credor).
- Hashes calculados pelo servidor, e não no navegador (textos do § 1 e do aviso legal ajustados).
- Campos conferidos pelo operador, coordenada confirmada pelo operador, nota de CGNAT, porta lógica, titular do bloco (RDAP) e Anexo I com quesitos judiciais.
- Achado "Ato praticado em município diverso do domicílio" comparado com a residência de referência geocodificada; a cidade do cadastro no contrato fica como reserva.
- País da geolocalização em português quando o provedor responde em inglês.

**Deixado de fora do SaaS antigo**

- Índice de anomalia de 0 a 100 ("risco crítico de fraude") da capa do PDF do servidor: contradizia a leitura do motor de que distância isolada não prova fraude.
- Classificação de completude da cadeia de custódia em percentual: o motor avalia por itens eliminatórios, e as duas leituras davam vereditos diferentes para o mesmo documento.

**Defeito do motor corrigido**

- Operadora com nome terminado em ponto ("TIM S.A.") gerava "provedor TIM S.A.." no § 4.1, e a higiene de texto do próprio motor bloqueava a geração do PDF.

## Créditos ilimitados do administrador da plataforma

Mudança feita no mesmo branch, fora do motor pericial, a pedido do dono do sistema.

- O usuário com `isPlatformAdmin` (super admin) gera laudos sem consumir créditos: a verificação de saldo é dispensada, nada é debitado, não há alerta de créditos acabando e, se a análise falhar, ela é marcada como erro sem estorno.
- Usuários clientes continuam dependendo de assinatura e créditos avulsos, sem nenhuma mudança.
- A marca vem do token de acesso assinado, gravado a partir do banco no login e em cada renovação. Não pode ser enviada pela requisição.
- A isenção é do usuário, não do escritório: outro membro do mesmo escritório do administrador continua consumindo créditos.
- `GET /api/credits/balance` passa a devolver `balance.unlimited`. O widget lateral e o painel mostram "Ilimitado" para o administrador.
- O log de auditoria `analysis_started` registra `creditoIsento`, para distinguir essas análises nos relatórios.
- Arquivos: `utils/creditPolicy.js` (novo), `middleware/creditGuard.js`, `controllers/analyzeController.js`, `controllers/creditController.js`, `jobs/analysisWorker.js`, `frontend/src/components/CreditWidget.jsx`, `frontend/src/pages/Dashboard.jsx`. Testes em `tests/creditoIlimitadoAdmin.test.js`.
- Limites operacionais do plano (análises simultâneas e por minuto) continuam valendo para o administrador, porque protegem a capacidade do servidor e não são cobrança.

## 10. Decisões pendentes de validação

| Decisão tomada | Alternativa |
|---|---|
| Réplica processual não consome crédito | Cobrar um crédito por réplica ou limitar por plano |
| Confronto com o processo não consome crédito | Cobrar como análise adicional |
| Resultado da réplica fica 7 dias no Redis, sem tabela | Tabela própria para histórico permanente |
| Tamanho do PDF do processo limitado a `MAX_PDF_MB` (30 MB) | Limite próprio para cadernos processuais |

---

## 11. Limitações conhecidas

- A releitura das páginas finais aumenta o tempo de análise de documentos escaneados.
- A leitura do catálogo não alcança objetos dentro de object streams comprimidos (PDF 1.5 ou superior); nesses arquivos a conclusão depende do `pdfsig`.
- A aferição matemática depende das datas extraídas. Quando elas vêm de quadros errados, o laudo exibe nota de conferência, mas os selos NÃO CONFERE podem refletir erro de leitura, não do contrato.
- O Caderno de Réplicas é versionado com o código; atualização do caderno exige novo deploy.
- Réplicas expiram. Após o prazo, é preciso reenviar os autos.
