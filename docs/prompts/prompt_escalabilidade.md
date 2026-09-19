# AUDITORIA DE ESCALABILIDADE E CARGA — ForenseDoc (validar capacidade + corrigir gargalos)

## Papel
Você é um engenheiro de performance/SRE sênior atuando com autorização total sobre
ESTA base de código, que é do próprio dono. Faça uma auditoria de escalabilidade do
sistema (API Node/Express, worker BullMQ, Postgres, Redis, nginx), meça a capacidade
real, encontre gargalos e CORRIJA os que forem seguros, seguindo as regras abaixo.
O objetivo final é responder com números: **quantos usuários simultâneos e quantas
análises por hora o sistema aguenta, e se a VPS escolhida basta ou precisa subir.**

## Infraestrutura-alvo (REAL — não invente outra)
- Um único host: **Hostinger KVM 4** — 4 vCPU, 16 GB RAM, 200 GB NVMe (confirme no
  painel; se o plano mudou, use os números reais e ajuste as conclusões).
- TODOS os serviços rodam no MESMO host, em Docker (`docker-compose.yml`):
  nginx (TLS) + backend (API :8787) + worker(s) BullMQ + Postgres 16 + Redis 7.
  Eles DISPUTAM as mesmas 4 vCPU e os mesmos 16 GB. Trate contenção de recursos
  entre serviços como problema central, não como detalhe.
- A análise do dossiê é **limitada por CPU** (OCR com tesseract sobre PDF escaneado).
  Vazão de análise ≈ (réplicas de worker) × (WORKER_CONCURRENCY_ANALYSIS), limitada
  pelo total de núcleos do host. Passar disso só aumenta troca de contexto.
- Redis: `maxmemory` + política `volatile-lru` (cache/rate-limit têm TTL; jobs não).
- Dossiê enviado é gravado em disco local (retenção 30 dias), NÃO em Redis nem fora
  do país (LGPD). Considere IO de disco no dimensionamento.

## Referenciais de método
- Método USE (Brendan Gregg): para cada recurso — CPU, memória, disco, rede, e as
  filas — meça Utilização, Saturação e Erros sob carga.
- Métricas RED para a API: Rate (req/s), Errors (%), Duration (p50/p95/p99).
- Capacity planning: descubra o ponto onde a vazão para de crescer (joelho da curva)
  e a partir de onde a latência dispara. Reporte o número, não uma impressão.

## Regras de trabalho (INEGOCIÁVEIS)
1. NÃO rode carga contra produção. Meça em ambiente isolado (`docker-compose.dev.yml`
   ou uma cópia do stack de produção numa máquina de teste). Nunca contra dados reais.
2. Antes de afirmar um gargalo, PROVE com medição: comando executado, número obtido,
   recurso saturado (arquivo:linha do código quando for código). Sem medição, marque
   como "hipótese" e não altere.
3. Corrija UM gargalo por vez. Após cada mudança, rode a suíte de testes
   (`npm test` no backend) e repita a medição para comprovar o ganho. Se piorar ou
   quebrar teste, reverta.
4. PARE e pergunte antes de mudanças que alterem comportamento de negócio, limites de
   plano, política de retenção, regra de crédito/débito, ou que exijam gastar dinheiro
   (Postgres/Redis gerenciado, upgrade de VPS). Traga o custo/benefício, não decida.
5. Não relaxe controles de segurança (rate-limit, allowlists, validação) para ganhar
   vazão. Performance não justifica abrir brecha.
6. Reaproveite o que já existe: `scripts/testeDeCarga.mjs`, `queueMetricsService.js`,
   a concorrência por fila em `src/worker.js`. Não reescreva o que já funciona.

## Escopo por área (o que medir e corrigir, específico desta app)

### A. Metas de carga (definir ANTES de medir)
- Estabeleça o modelo de carga alvo com o dono: nº de usuários simultâneos esperado
  no lançamento e no futuro; análises por hora no pico; tamanho típico do dossiê
  (nº de páginas, digital vs escaneado); proporção leitura (polling de status) vs
  escrita (upload/geração).
- Defina SLOs mensuráveis: p95 de latência das rotas de API (ex.: < 500 ms fora da
  análise), tempo aceitável de uma análise ponta a ponta, e tempo máximo tolerável na
  fila em horário de pico. Todo o resto do relatório se mede contra esses alvos.

### B. Pipeline de análise — o gargalo de CPU (PRIORIDADE MÁXIMA)
- Rode `node scripts/testeDeCarga.mjs <pdf_escaneado.pdf> 1,2,4,6,8 3` com um PDF
  escaneado representativo (pior caso, o que os bancos entregam). Ache o joelho da
  curva: a concorrência a partir da qual a vazão para de subir. Esse é o valor certo
  de `WORKER_CONCURRENCY_ANALYSIS` para 4 vCPU.
- Meça o custo de UMA análise: segundos de CPU, RAM de pico, IO. Extrapole:
  análises/hora sustentáveis = f(núcleos disponíveis para o worker, custo por análise).
- Verifique cancelamento/timeout de OCR por nº de páginas (evitar job que trava um
  núcleo indefinidamente). Confirme que o worker não estoura RAM com dossiê grande.

### C. Fila BullMQ — concorrência, backpressure e resiliência
- Filas `analysis/payments/emails/crons` com concorrência independente: confirme que
  os valores fazem sentido para 4 vCPU (analysis baixo por ser CPU-bound; emails e
  payments podem ser mais altos por serem IO-bound).
- Backpressure: o que acontece quando a fila enche? A API aceita upload indefinidamente
  enquanto a fila cresce? Deve haver limite/aviso e o Redis não pode despejar jobs
  (confirme que jobs NÃO têm TTL e a política é `volatile-lru`).
- Idempotência e retry: job repetido (retry após falha, ou webhook duplicado) processa
  duas vezes? Débito de crédito e efeito de webhook precisam ser idempotentes SOB
  concorrência (ligue com a auditoria de segurança — race no débito).
- Graceful shutdown: confirme que `SIGTERM` espera o job em andamento (já existe em
  `worker.js`) e que jobs órfãos após crash são reprocessados, não perdidos.
- Escala horizontal: valide `docker compose up -d --scale worker=N` e meça vazão real
  com 1, 2 e 3 réplicas — lembrando que somadas não podem passar dos 4 núcleos.

### D. Redis
- `maxmemory` ≈ 70% da RAM DEDICADA ao container (não 70% do host — o host é
  compartilhado). Confirme `REDIS_MAXMEMORY` coerente com o `mem_limit` do container.
- Sob carga, meça uso de memória (`redis-cli INFO memory`), nº de conexões
  (BullMQ + rate-limit + cache abrem quantas?), e se `appendonly yes` (AOF) vira
  gargalo de IO no NVMe compartilhado.
- Confirme que despejo sob pressão atinge só chaves com TTL (cache/rate-limit) e nunca
  a fila.

### E. Postgres (no mesmo host)
- Pool de conexões: quantas conexões o backend + réplicas de worker abrem no total,
  contra o `max_connections` do Postgres? Um pool grande × várias réplicas esgota o
  Postgres single-host. Dimensione o pool ao host.
- Queries: rode `EXPLAIN ANALYZE` nas quentes (polling de status da análise, listagens
  por tenant, débito de crédito). Confirme índices em toda coluna de filtro/ordenação
  e nas FKs de tenant. Caçe N+1 nos controllers. Confirme que o polling de status usa
  `select` enxuto (não carrega o laudo inteiro a cada 2 s).
- Sob carga sustentada: autovacuum acompanha? Há tabela que só cresce (logs/eventos)
  sem retenção?

### F. API / HTTP sob carga
- Teste as rotas quentes com k6 ou autocannon (instale como devDependency isolada ou
  rode via container): login, upload do dossiê, polling de status, geração/consulta de
  laudo. Reporte RED (req/s, erro %, p50/p95/p99) por rota.
- Upload: o dossiê chega em base64? Meça o custo de memória/CPU de decodificar payloads
  grandes e confirme limite de tamanho de body. Um upload gigante não pode derrubar a
  API.
- Rate-limit sob carga: confirme que os limites (express-rate-limit + Redis) protegem
  sem barrar uso legítimo no pico previsto. Keep-alive e timeouts do nginx e do Node
  coerentes com o tempo de análise.

### G. Contenção de recursos no host (o ponto KVM 4)
- Rode a carga combinada (API + análises na fila ao mesmo tempo) e capture com
  `docker stats` e `vmstat`/`htop`: CPU% por container, load average, RAM livre, uso de
  swap (swap em uso = alerta vermelho num host de 16 GB), IO do NVMe, rede.
- Confirme que CADA container tem `mem_limit`/`cpus` no compose, para um serviço em
  pico (ex.: worker no OCR) não causar OOM e derrubar Postgres/Redis junto. Se não
  houver limites, propor limites por serviço somando ≤ recursos do host, com folga.
- Identifique o recurso que satura PRIMEIRO sob a carga-alvo (quase certamente CPU).

### H. Veredicto de capacidade — KVM 4 basta? (ENTREGÁVEL PRINCIPAL)
Com base SÓ nos números medidos, responda explicitamente:
- Quantos usuários simultâneos e quantas análises/hora a KVM 4 sustenta dentro dos
  SLOs da área A, com que folga (headroom).
- Até que volume a KVM 4 basta; a partir de qual ponto ela satura.
- Se/quando subir para KVM 8 (8 vCPU / 32 GB) OU separar Postgres/Redis para serviço
  gerenciado (tirando-os da disputa de CPU do host) — compare as duas rotas por
  custo/benefício.
- Gatilhos objetivos de upgrade para monitorar em produção, por exemplo: CPU sustentada
  > 70%, swap em uso, profundidade da fila de análise crescendo sem drenar no pico,
  p95 de API acima do SLO. Use os números reais que você mediu.

## Entregável
Relatório em Markdown com:
1. Modelo de carga e SLOs acordados (área A).
2. Tabela vazão × concorrência do pipeline de análise, com o joelho da curva e o
   `WORKER_CONCURRENCY_ANALYSIS` recomendado.
3. Resultado dos testes de carga da API (RED por rota) e das medições de host
   (USE por recurso) sob a carga-alvo.
4. Lista de gargalos: cada um com medição que o prova, correção aplicada (diff
   resumido) e ganho medido depois. Itens que exigiram parar para consultar, com o
   motivo.
5. **Veredicto KVM 4**: capacidade suportada, folga, e recomendação clara (manter,
   subir para KVM 8, ou separar banco/redis) com os gatilhos de escala.
6. `npm test` antes e depois.
Comece pela área A (metas), depois B (o gargalo de CPU) — sem meta e sem medição do
custo por análise, o resto não se conclui.
