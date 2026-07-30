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
