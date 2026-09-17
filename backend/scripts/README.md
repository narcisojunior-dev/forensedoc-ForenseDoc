# Scripts operacionais

Não fazem parte do serviço. São ferramentas de medição e diagnóstico.

## `testeDeCarga.mjs`

Executa o pipeline de análise (extração, OCR, geolocalização, cadeia de custódia)
variando a concorrência, e reporta mediana, p95, vazão e pico de heap.

```bash
node scripts/testeDeCarga.mjs /tmp/escaneado.pdf 1,2,4,6 2
```

O que se procura é onde a **vazão para de crescer**. Esse é o valor certo de
`WORKER_CONCURRENCY_ANALYSIS` para o host: acima dele, aumentar a concorrência só
aumenta a latência de cada análise, sem entregar mais laudos por minuto.

Rode no host de produção antes de definir o valor. Os defaults do `worker.js` são
conservadores porque foram calibrados por projeção, não por medição no host real.

## `gerarPdfEscaneado.mjs`

Rasteriza um PDF, removendo a camada de texto, para produzir um documento que
aciona OCR.

```bash
node scripts/gerarPdfEscaneado.mjs entrada.pdf /tmp/escaneado.pdf 20
```

Existe porque testar carga com PDF digital mede o caso fácil: menos de um segundo
por análise, contra dezenas de segundos quando há OCR. Os documentos que os
bancos entregam são digitalizações, então o caminho caro é o caminho comum.

## `homologarDossie.mjs`

Roda o pipeline de análise sobre o PDF real do dossiê C6 da homologação e confere
cada valor de referência do relatório (data do contrato, aferição matemática,
procedência, trilha, biometria, seguro, testes negativos e coerência entre seções).

```bash
node scripts/homologarDossie.mjs ../../documentação/doc_teste/dossiê.pdf
```

Sai com código 1 se algum item não conferir. O PDF tem dados pessoais reais e não
fica no repositório.

## `varrerLaudosAfetados.js`

Lista análises concluídas cujos laudos podem conter os defeitos corrigidos na
homologação (data do tribunal como data do contrato, CET travado em 20%,
composição sem seguro, referência residencial de outra UF, protocolo tratado como
hash, benefício do INSS em consignado CLT, reimpressão imputada ao banco).

```bash
node scripts/varrerLaudosAfetados.js --desde=2026-09-01 --saida=afetados.json
```

Somente leitura: não altera, não reprocessa e não notifica. A saída traz só
identificadores internos e critérios atingidos. Confira para qual banco a
`DATABASE_URL` aponta antes de rodar.
