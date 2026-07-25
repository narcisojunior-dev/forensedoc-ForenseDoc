# Fase Final — Lacunas Pendentes até o Launch

> **Documento de execução.** Complementa `implementation-plan.md`, que descreve os módulos 1–7 (todos implementados).
> Aqui estão apenas as **lacunas remanescentes**: o que ainda impede abrir as 25 vagas de fundador e o que falta do checklist de hardening.
>
> **Data do levantamento:** 24/07/2026 · **Base:** commit `c0a6cf9`
> **Convenção:** marcar `[x]` conforme concluído e registrar o commit ao lado do bloco.

---

## Contexto — por que este documento existe

Os checkboxes de `implementation-plan.md` nunca foram atualizados, o que dá a impressão de que módulos inteiros estão pendentes. **Não estão.** Auditoria de código confirma:

| Módulo do plano | Status | Evidência principal |
|---|---|---|
| Fase 0 — Infra Railway | ✅ Feito | `railway.json`, `Dockerfile`, `backend/scripts/db-deploy.js` |
| M1 — Auth & Multi-tenant | ✅ Feito | `backend/src/controllers/authController.js` (refresh rotation com reuse detection) |
| M2 — Credits Engine | ✅ Feito | `backend/src/services/creditService.js` (4 buckets), `middleware/creditGuard.js` |
| M3 — Billing / Asaas | ✅ Feito | `backend/src/services/asaasService.js`, `jobs/webhookProcessor.js` |
| M4 — Motor de Análise | ✅ Feito | `backend/src/jobs/analysisWorker.js`, `services/reportPdfService.js` |
| M5 — Frontend | ✅ Feito | 13 páginas em `frontend/src/pages/` |
| M6 — Admin Panel | ✅ Feito | `backend/src/controllers/adminMetricsController.js` |
| M7 — Notificações | ✅ Feito | `backend/src/services/notificationService.js` |

> **Nota:** "fase A / B / C" nos commits recentes **não são fases do plano**. São um recorte ad-hoc criado para fechar lacunas do M4 (hashes+§5 no worker, PDF server-side) e do M6 (métricas, planos, audit log).

O que resta são **lacunas de integração** — pontas soltas entre backend pronto e frontend que não as consome — mais o **checklist de hardening** que nunca foi executado.

---

## Sumário das lacunas

| # | Lacuna | Severidade | Bloqueia launch? |
|---|---|---|---|
| L1 | ~~Fluxo Fundador inalcançável~~ | ✅ Feita | — |
| L2 | Aceite de convite de equipe sem UI | 🔴 Crítica | **Sim** (planos multi-usuário) |
| L3 | Preços da Landing divergem do banco | 🟠 Alta | **Sim** (risco jurídico/comercial) |
| L4 | Dashboard com métricas falsas (`0` hardcoded) | 🟠 Alta | Não, mas visível ao cliente |
| L5 | Histórico de pagamentos não exposto | 🟡 Média | Não |
| L6 | 3 templates de e-mail ausentes (bomba-relógio) | 🟡 Média | Não |
| L7 | Rota `/v2` é código morto que dá 401 | 🟡 Média | Não |
| L8 | Onboarding só em `localStorage` | 🟢 Baixa | Não |
| L9 | Código morto e higiene (`geocodeAddress`, §6 do laudo, 404, error boundary) | 🟢 Baixa | Não |
| FL | Fase Final — Hardening & Launch (FL.1–FL.5) | 🔴 Crítica | **Sim** |
| B1 | Programa de indicação (schema-only) | ⚪ Backlog | Não (Fase 3 PRD) |
| B2 | ~~Excedente~~ → avulso com desconto p/ assinante | ✅ Feita | — |
| B3 | Migração de geocodificação para LocationIQ | ⚪ Backlog | Não (Fase 3 PRD) |

---

# Bloco 1 — Bloqueadores do Launch Fundadores

## L1 — Fluxo Fundador — ✅ RESOLVIDA (24/07/2026)

**Sintoma:** as 25 vagas de fundador — o modelo comercial inteiro da Fase 1 do PRD — não podem ser vendidas. O admin gera códigos que ninguém consegue resgatar.

**Evidência:**
- `frontend/src/pages/Plans.jsx:42` — `setPlans(plansRes.data.plans.filter((p) => !p.isFounder))` remove o plano fundador da tela.
- `frontend/src/pages/Plans.jsx:64` — `api.post("/billing/subscribe", { planId, billingType, isAnnual })` nunca envia `founderInviteCode`.
- `backend/src/controllers/billingController.js:71-75` — exige o código: `if (plan.isFounder) { if (!founderInviteCode) return 400 "Este plano exige um código de convite de fundador." }`.
- `backend/src/controllers/billingController.js:22` — `founderInviteCode: z.string().optional()` já aceito no schema Zod.
- `frontend/src/pages/admin/AdminFounders.jsx` — gera os códigos via `POST /admin/founder-invites`, sem destino.
- `backend/prisma/seed.js:45-50` — plano `fundador`, R$ 197, `isFounder: true`, 25 slots.

**Backend estava 100% pronto** — exceto pela validação prévia do código, que não existia. O resto da lacuna era de frontend.

### Checklist

- [x] Mecanismo de entrada escolhido: **query param `?founder=CODIGO`** no link que o admin entrega. Sem digitação, e o convidado cai direto no card já validado
- [x] Filtro `.filter((p) => !p.isFounder)` mantido de propósito em `frontend/src/pages/Plans.jsx` — o plano fundador **nunca** entra na vitrine geral; aparece só no card dedicado, e apenas com código válido
- [x] Card do fundador com destaque, preço travado 12 meses, laudos/mês e contador `founderSlotsRemaining` / `founderSlotsTotal`
- [x] `founderInviteCode` propagado em `handleSubscribe(plan, { isFounderPlan: true })`
- [x] Validação prévia via **`GET /billing/founder-invite/:code`** — criado em `backend/src/controllers/billingController.js`, rota pública em `billingRoutes.js` com `founderInviteLimiter` (30/h por IP) em `middleware/rateLimiters.js`
- [x] UI trata os erros do backend por código: `FOUNDER_INVITE_INVALID`, `FOUNDER_INVITE_USED`, `FOUNDER_SLOTS_EXHAUSTED`, `FOUNDER_PLAN_UNAVAILABLE`, `FOUNDER_INVITE_RATE_LIMITED` (mapa `FOUNDER_ERRORS` em `Plans.jsx`)
- [x] `AdminFounders.jsx` copia o **link completo** e o exibe abaixo do código; texto de ajuda atualizado
- [x] Vagas esgotadas: card não aparece, banner explica o motivo, e o código é descartado da sessão

**Item que o levantamento não previu e foi necessário:**

- [x] **O código se perdia no login.** O link aponta para `/dashboard/plans`, rota protegida; o `ProtectedRoute` salva `state.from`, mas `Login.jsx:29` **ignora** esse estado e navega sempre para `/dashboard` ou `/onboarding`. Um convidado deslogado — o caso mais provável — perderia o código. Resolvido com `frontend/src/utils/founderInvite.js` (captura em `sessionStorage` no boot do app, via `captureFounderCode()` em `App.jsx`), que sobrevive ao redirecionamento sem mexer no fluxo de login

### Verificação

Executada contra o Postgres de desenvolvimento (`forensedoc_dev`), backend na porta 8799:

- [x] `GET /billing/founder-invite/:code` — código válido → 200 com dados do plano; **case-insensitive** (link em minúsculo funciona)
- [x] Código inexistente → 404 `FOUNDER_INVITE_INVALID`
- [x] Código já utilizado → 409 `FOUNDER_INVITE_USED`
- [x] `founderSlotsRemaining = 0` → 409 `FOUNDER_SLOTS_EXHAUSTED`
- [x] Rate limit: bloqueio em 429 após 30 consultas/hora por IP
- [x] Endpoint responde **sem token** (público, como projetado)
- [x] `POST /billing/subscribe` **sem** código no plano fundador → 400 "Este plano exige um código de convite de fundador" — reprodução exata do bug original que o frontend causava
- [x] Com código inválido ou já usado → 400 "Código de convite inválido ou já utilizado"
- [x] Com código **válido** → passa por todas as validações de fundador e só falha na Asaas (502), provando que a cadeia de guards aceita o código
- [x] **Falha na Asaas não queima o convite:** `usedAt` seguiu `null`, `founderSlotsRemaining` seguiu 25, nenhuma `Subscription` criada — o consumo do convite está dentro da transação, depois da chamada externa
- [x] Dados de teste removidos do banco de dev ao final

**Não verificado (bloqueado por ambiente):** o caminho feliz completo — `usedAt` preenchido, slot decrementado e `founderLockedUntil` em +12 meses. `ASAAS_API_KEY` no `.env` é placeholder (20 chars, prefixo `ASAAS_`), então nenhuma assinatura real pode ser criada localmente. Essa parte é código pré-existente (`billingController.js`, transação de `subscribe`) que não foi alterado nesta lacuna.

- [ ] **Pendente:** rodar o caminho feliz com chave de sandbox da Asaas válida → confirmar `FounderInvite.usedAt`, `Plan.founderSlotsRemaining` decrementado e `Subscription.founderLockedUntil` = +12 meses
- [ ] **Pendente:** confirmar que o upgrade dentro do período travado é bloqueado (depende de uma assinatura fundador real)

### Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `backend/src/controllers/billingController.js` | `getFounderInvite()` — validação prévia |
| `backend/src/routes/billingRoutes.js` | rota pública `GET /founder-invite/:code` |
| `backend/src/middleware/rateLimiters.js` | `founderInviteLimiter` (30/h por IP, anti-enumeração) |
| `frontend/src/utils/founderInvite.js` | **novo** — captura/persistência/link do código |
| `frontend/src/App.jsx` | `captureFounderCode()` no boot |
| `frontend/src/pages/Plans.jsx` | card do fundador, validação, propagação do código, tratamento de erros |
| `frontend/src/pages/admin/AdminFounders.jsx` | link completo copiável |

---

## L2 — Aceite de convite de equipe sem UI 🔴

**Sintoma:** o titular envia o convite, o colega recebe o e-mail com o botão "Aceitar convite", clica — e não existe página para receber esse link. Os planos Escritório (3 usuários) e Massa (5 usuários) vendem multi-usuário que não fecha.

**Evidência:**
- `backend/src/routes/tenantRoutes.js:16-17` — `GET /invite/:token` e `POST /invite/:token/accept` existem, públicos, com `inviteLimiter` (20/h).
- `backend/src/emails/templates.js:105-115` — template `INVITE_RECEIVED` já monta `button("Aceitar convite", inviteUrl)`.
- `frontend/src/App.jsx` — **não existe rota** para `/invite/:token` nem equivalente.
- `frontend/src/pages/Settings.jsx` — só o lado emissor (`POST /tenant/invite`).
- `backend/src/controllers/tenantController.js` — `acceptInvite` revalida o limite de assentos dentro de transação **Serializable** (correto, mantém).

### Checklist

- [ ] Criar `frontend/src/pages/AcceptInvite.jsx` (rota pública `/invite/:token` em `frontend/src/App.jsx`)
- [ ] Ao montar, chamar `GET /api/tenant/invite/:token` e exibir nome do escritório + quem convidou
- [ ] Tratar os estados de token: válido, expirado (72h), já utilizado, inexistente — cada um com mensagem e CTA próprios
- [ ] Renderizar formulário de criação de conta do membro (nome, senha, OAB) e submeter em `POST /api/tenant/invite/:token/accept`
- [ ] Após aceite, autenticar e redirecionar para `/dashboard` (reaproveitar o fluxo de `authStore.login`, não duplicar lógica de token)
- [ ] Tratar o 4xx de "assentos esgotados" — pode ocorrer entre o envio e o aceite se o titular preencher as vagas nesse intervalo
- [ ] Conferir se `inviteUrl` gerado no backend aponta para a rota nova (verificar a construção da URL em `tenantController.js` / `frontendUrl()` em `templates.js`)
- [ ] Em `Settings.jsx`, listar convites **pendentes** com opção de reenviar/revogar (hoje só lista membros ativos)

### Verificação

- [ ] Convidar um e-mail → capturar o link no log do mailer (dev) → aceitar em janela anônima → confirmar `User` criado com `role: MEMBER` e `tenantId` correto
- [ ] Confirmar que o novo membro consome créditos do **mesmo** `CreditBalance` do escritório
- [ ] Confirmar que o membro **não** acessa rotas de OWNER (billing, remoção de membros → 403)
- [ ] Estourar o limite de assentos do plano → aceite deve falhar com mensagem clara

---

## L3 — Preços da Landing divergem do banco 🟠

**Sintoma:** a página pública anuncia preços que não existem. Cliente entra por R$ 147 e encontra R$ 197 no checkout — risco de reclamação e de discussão sobre publicidade enganosa.

**Evidência:**

| Landing (`frontend/src/pages/Landing.jsx`) | Banco (`backend/prisma/seed.js`) |
|---|---|
| `:193` — R$ 147 | `inicial` = R$ 197,00 |
| `:218` — R$ 397 | `profissional` = R$ 297,00 |
| `:240` — R$ 29 | avulso = R$ 79,00 (`billingController.js` `AVULSO_PRICE_BRL`) |
| — | `escritorio` R$ 597, `massa` R$ 1.990 (não anunciados) |

Agrava: `PATCH /api/admin/plans/:id` permite editar preços em runtime, então qualquer valor hardcoded volta a divergir na primeira alteração.

### Checklist

- [ ] Consumir `GET /api/billing/plans` (endpoint **público**, sem auth — confirmado em `backend/src/routes/index.js`) em `Landing.jsx`
- [ ] Renderizar os cards a partir da resposta: nome, `priceBrl`, `monthlyCredits`, `maxUsers`
- [ ] Filtrar `isFounder` da vitrine pública (o plano fundador só aparece via link com código — ver L1)
- [ ] Definir a fonte da verdade das **features** de cada plano: adicionar coluna `features` (JSON) em `Plan` **ou** manter um mapa `slug → features[]` no frontend. Decidir e documentar; misturar preço dinâmico com feature estática é aceitável, preço estático não é
- [ ] Exibir o preço do avulso a partir do backend — hoje `AVULSO_PRICE_BRL = 79.0` está hardcoded em `backend/src/controllers/billingController.js:29`; expor via `GET /billing/plans` ou config
- [ ] Estado de loading/erro: se a API falhar, **não** renderizar preço algum (melhor omitir que mentir)
- [ ] Revisar a mesma divergência em qualquer copy de e-mail (`backend/src/emails/templates.js:147` cita "R$ 79" — conferir se bate)

### Verificação

- [ ] Alterar um preço via `PATCH /admin/plans/:id` → recarregar a Landing → valor novo aparece sem redeploy
- [ ] Comparar lado a lado Landing × `/dashboard/plans` × fatura do Asaas — os três devem exibir o mesmo número

---

## L4 — Dashboard com métricas falsas 🟠

**Sintoma:** o cliente paga e vê "Laudos Gerados: 0" e "Horas Economizadas: 0h" permanentemente, mesmo após gerar dezenas de laudos. É o único `TODO` literal do repositório.

**Evidência:**
- `frontend/src/pages/Dashboard.jsx:66` — `{/* Mock: TODO conectar com API de análises */}` seguido de `0` fixo
- `frontend/src/pages/Dashboard.jsx:~80` — `0h` fixo
- Já funcionam de verdade: o tile de créditos (`authStore.balance`) e a lista de transações (`GET /credits/transactions?limit=5`)

### Checklist

- [ ] Decidir a fonte do total de laudos: reaproveitar `GET /api/analyses?page=1&limit=1` e ler o total da paginação **ou** criar um endpoint enxuto `GET /api/analyses/stats` (preferível — evita puxar payload de análise para exibir um contador)
- [ ] Se optar por endpoint novo: implementar em `backend/src/controllers/analyzeController.js` com `count` por `tenantId` e `status: COMPLETED`, escopado pelo `req.tenantId` do JWT (nunca do body)
- [ ] Substituir o `0` hardcoded em `Dashboard.jsx:66` pelo valor real
- [ ] Resolver "Horas Economizadas": ou derivar de uma constante declarada e honesta (ex.: `laudosConcluídos × 2h`, com rodapé "estimativa"), ou **remover o tile**. Número inventado sem lastro em produto forense é pior que tile a menos
- [ ] Adicionar skeleton/loading nos tiles em vez de piscar `0` durante o fetch
- [ ] Conferir que a contagem respeita isolamento multi-tenant

### Verificação

- [ ] Gerar 2 laudos em um tenant novo → contador exibe 2
- [ ] Logar em outro tenant → contador não vaza o total do primeiro
- [ ] Análise em `ERROR`/`REFUNDED` não deve entrar na contagem de "gerados"

---

## L5 — Histórico de pagamentos não exposto 🟡

**Sintoma:** dois endpoints prontos sem nenhum consumidor. O cliente não consegue ver o que já pagou; o admin não vê o fluxo financeiro consolidado.

**Evidência:**
- `GET /api/billing/payments` — implementado em `backend/src/controllers/billingController.js`, sem chamador no frontend
- `GET /api/admin/payments` — implementado em `backend/src/controllers/adminMetricsController.js`, sem chamador no frontend

### Checklist

- [ ] Adicionar seção "Histórico de pagamentos" em `frontend/src/pages/Plans.jsx` (ou aba em `Settings.jsx`) consumindo `GET /billing/payments`
- [ ] Exibir por linha: data, tipo (`SUBSCRIPTION`/`AVULSO`), valor, status, link da fatura quando `PENDING`/`OVERDUE`
- [ ] Traduzir os enums `PaymentStatus`/`PaymentType` para rótulos em português
- [ ] Criar aba "Pagamentos" em `frontend/src/pages/Admin.jsx` consumindo `GET /admin/payments`, com filtro por status e período
- [ ] Paginação em ambas as telas (conferir se os endpoints já paginam; se não, adicionar)

### Verificação

- [ ] Rodar `backend/scripts/make-subscriber.js` para simular um `PAYMENT_RECEIVED` e confirmar que a linha aparece nas duas telas

---

# Bloco 2 — Dívidas técnicas e higiene

## L6 — Três templates de e-mail ausentes 🟡

**Sintoma:** bomba-relógio. `renderEmail` lança exceção para templates inexistentes; hoje não quebra apenas porque os dois call sites passam `email: false`. Qualquer mudança para `email: true` derruba o job.

**Evidência:**
- `backend/src/emails/templates.js:224-227` — `if (!build) throw new Error("EMAIL_TEMPLATE_NOT_FOUND: " + template)`
- `EMAIL_TEMPLATES` cobre 11 dos 12 `NotificationType`; faltam **`CREDITS_GRANTED`**, **`ANALYSIS_COMPLETED`**, **`REFERRAL_CONVERTED`**
- `backend/prisma/schema.prisma:66-79` — enum com os 12 tipos
- Call sites hoje seguros: `backend/src/controllers/adminController.js:263` (`CREDITS_GRANTED`, `email: false`) e `backend/src/jobs/analysisWorker.js:80` (`ANALYSIS_COMPLETED`, `email: false`)
- `REFERRAL_CONVERTED` não tem call site algum (ver B1)

> Correção a um levantamento anterior: `ANALYSIS_ERROR` **existe** (`templates.js:207`) e é o único desses fluxos que envia e-mail de fato (`analysisWorker.js:103`, sem `email: false`).

### Checklist

- [ ] Implementar `CREDITS_GRANTED({ amount, notes })` — crédito manual concedido pelo admin
- [ ] Implementar `ANALYSIS_COMPLETED({ analysisId })` — mesmo mantendo `email: false` por padrão, o template precisa existir para o dia em que alguém ligar o envio
- [ ] Implementar `REFERRAL_CONVERTED({ referredName, bonus })` — ou remover o valor do enum se o programa de indicação (B1) for descartado
- [ ] Reaproveitar os helpers existentes `layout()`, `p()`, `button()`, `escapeHtml()`, `frontendUrl()` de `templates.js` — não criar novos
- [ ] Adicionar teste/asserção de completude: iterar sobre os valores do enum `NotificationType` e falhar se algum não tiver template correspondente. **Este é o item que impede a regressão voltar**
- [ ] Revisar a decisão de `email: false` em `ANALYSIS_COMPLETED`: o comentário em `analysisWorker.js:78` justifica ("o usuário está olhando a tela"), mas análises longas com OCR podem passar de 60s e o usuário sair da página

### Verificação

- [ ] Rodar a asserção de completude e confirmar 12/12
- [ ] Conceder crédito manual pelo admin com `email: true` temporário → e-mail renderiza sem exceção

---

## L7 — Rota `/v2` é código morto que dá 401 🟡

**Sintoma:** `/v2` expõe o monolito da v2.2 (843 linhas) que falha logo no pre-flight. Superfície pública morta.

**Evidência:**
- `frontend/src/App.jsx` — rota `/v2` → `frontend/src/ForenseDoc.jsx`
- `frontend/src/utils/api.js:27` — `checkBackendReady()` chama `GET ${API_BASE}/api/health`, que **não existe**: o health está montado em `/health` e `/health/ready` (`backend/server.js:82,96`), fora do prefixo `/api`
- `frontend/src/utils/api.js:5,16` — `/api/ip/:ip` e `/api/geocode` via `fetch` **sem** `Authorization`; ambas hoje exigem `requireAuth` (`backend/src/routes/index.js:47-63`) → 401

**Decisão necessária:** remover ou consertar. Recomendação: **remover**. O fluxo autenticado em `pages/Analyze.jsx` substitui integralmente o `/v2`, que ainda calcula hash no browser — abordagem superada pela Fase A (hash no worker, forensicamente auditável).

### Checklist (rota de remoção)

- [ ] Remover a rota `/v2` de `frontend/src/App.jsx`
- [ ] Excluir `frontend/src/ForenseDoc.jsx`
- [ ] Excluir `frontend/src/utils/api.js` (só o `/v2` o usa via `fetch` cru; o resto do app usa `frontend/src/lib/axios.js`)
- [ ] Verificar se `frontend/src/styles/ForenseDoc.css` ainda é usado por `Analyze.jsx`/`History.jsx` antes de excluir — **provavelmente sim**, não remover às cegas
- [ ] Confirmar que `UiComponents.jsx` e `DistanceBanner.jsx` permanecem (compartilhados com `Analyze.jsx` e `History.jsx`)
- [ ] Rodar o build e caçar imports órfãos

### Checklist (rota alternativa — manter)

- [ ] Corrigir `checkBackendReady()` para `GET /health` (fora de `/api`)
- [ ] Migrar `frontend/src/utils/api.js` para a instância axios autenticada de `frontend/src/lib/axios.js`
- [ ] Colocar `/v2` atrás de `ProtectedRoute`

---

## L8 — Onboarding só em `localStorage` 🟢

**Sintoma:** o onboarding se repete a cada novo navegador/dispositivo, porque o "já vi" não é persistido no servidor.

**Evidência:** `frontend/src/pages/Onboarding.jsx:31` grava `onboarding_seen_${user.id}`; `frontend/src/pages/Login.jsx:29` lê a mesma chave.

### Checklist

- [ ] Adicionar `onboardedAt DateTime?` ao model `User` em `backend/prisma/schema.prisma` + migration
- [ ] Retornar o campo em `GET /api/auth/me`
- [ ] Persistir via `PATCH /api/auth/me` (endpoint já existe) na conclusão do onboarding
- [ ] Trocar a leitura de `localStorage` por `user.onboardedAt` em `Login.jsx:29`
- [ ] Manter o `localStorage` como fallback otimista para evitar flash de tela

---

## L9 — Higiene geral 🟢

### Checklist

- [ ] **Código morto:** remover `geocodeAddress` de `backend/src/services/apiService.js` — superado por `backend/src/services/geocodingService.js` (CEP-first + verificação de cidade), sem nenhum importador
- [ ] **Numeração do laudo:** `backend/src/services/reportPdfService.js` pula de §5 para §7 — não existe §6. Renumerar ou documentar a ausência; num documento forense a numeração não contígua chama atenção do perito adversário
- [ ] **Rota 404:** adicionar catch-all `path="*"` em `frontend/src/App.jsx` — hoje URL inválida renderiza tela branca
- [ ] **Error boundary:** envolver as rotas do dashboard para que uma exceção de render não derrube o app inteiro
- [ ] **`AdminRoute` retorna `null` durante o loading** (`frontend/src/components/AdminRoute.jsx`) — trocar por spinner
- [ ] **Deep-link do admin:** as 5 seções de `frontend/src/pages/Admin.jsx` são estado de aba, não rotas — converter em rotas aninhadas para permitir link direto e voltar do navegador
- [ ] **Métrica de churn aproximada:** `backend/src/controllers/adminMetricsController.js:414-422` usa "ativos hoje + cancelados no mês" como denominador em vez de snapshot do início do mês. Documentar a fórmula na UI **ou** corrigir para snapshot real
- [ ] **`@sentropic/graphify`** consta em `frontend/package.json` sem nenhum import em `src/` — remover a dependência e avaliar se `frontend/graphify-out/` deve continuar versionado
- [ ] **Docs desatualizados:** `README.md` e `HANDOFF-PROGRAMADOR.md` ainda descrevem a v2.2 monolítica (hash no browser, sem auth/créditos/Prisma). `docs/memory.md` está vazio
- [ ] **Marcar os checkboxes** de `docs/saas/implementation-plan.md` para os módulos 1–7 concluídos
- [ ] **Seção 13 ausente:** o índice de `implementation-plan.md` promete "Migração Railway → VPS" mas a seção não existe no corpo (a numeração pula direto para "14. Ordem de Execução Resumida"). Escrever ou remover do índice

---

# Bloco 3 — Fase Final: Hardening & Launch

> Corresponde a FL.1–FL.5 de `implementation-plan.md`. Nenhum item foi executado.
> **Correção a levantamento anterior:** `backend/scripts/smoke-test.sh` **existe** (6,6 KB, executável) — falta rodá-lo contra o ambiente publicado.

## FL.1 — Checklist de Segurança Pré-Launch

**Infraestrutura** *(itens de VPS ficam pendentes enquanto rodar em Railway — marcar N/A e retomar na migração)*

- [ ] Firewall UFW com apenas 22, 80, 443 abertas · N/A no Railway
- [ ] SSH com chave, login por senha desabilitado · N/A no Railway
- [ ] Fail2ban ativo para SSH e Nginx · N/A no Railway
- [ ] Certbot com renovação automática testada · N/A no Railway (TLS gerenciado)
- [ ] Todos os secrets em variáveis de ambiente, nada no git
- [ ] `.env` com permissão `600` — **atenção: existe um `.env` com valores reais em `backend/`**; confirmar que está no `.gitignore` e revisar permissão do arquivo

**Aplicação**

- [ ] Todos os endpoints protegidos por `requireAuth` — testar cada rota sem token e esperar 401
- [ ] **Tenant isolation:** autenticar no tenant A e tentar `GET /api/analyses/:id` de uma análise do tenant B → deve dar 403/404. Repetir para créditos, notificações, membros, billing
- [ ] Rate limiting: brute force em `POST /auth/login` → 429 após 10 tentativas/15min
- [ ] Cabeçalhos de segurança validados em securityheaders.com (Helmet configurado em `backend/server.js`)
- [ ] Confirmar que o PDF **nunca** é salvo em disco — auditar `pdfService.js`, `ocrService.js` (o `pdftoppm` grava temporários: verificar se são apagados no `finally`)
- [ ] Webhook Asaas com token inválido → 401 (`backend/src/controllers/webhookController.js`)
- [ ] **`ASAAS_WEBHOOK_IPS` está vazio em `.env.example`** e `backend/src/middleware/webhookIpAllowlist.js` **falha aberto** por design. Preencher com os IPs oficiais do Asaas **antes** de aceitar dinheiro real
- [ ] Revisar o fail-open dos rate limiters quando o Redis cai (`backend/src/utils/rateLimitStore.js`) — decidir conscientemente entre disponibilidade e proteção contra brute force, e registrar a decisão
- [ ] Confirmar que nenhum endpoint aceita `tenantId` vindo do body (regra §2.2 do plano)

**Dados**

- [ ] Backup automático testado: `pg_dump` + restore completo em ambiente de teste
- [ ] Cópia do backup **fora** da infraestrutura principal
- [ ] Índices verificados com `EXPLAIN ANALYZE` nas queries quentes: listagem de análises por tenant, saldo de créditos, audit log

## FL.2 — Checklist de Performance

- [ ] `POST /auth/login` < 500 ms (inclui bcrypt com salt ≥ 12)
- [ ] `GET /credits/balance` < 100 ms (cache Redis de 30 s em `creditService.js`)
- [ ] Job de análise completo < 30 s para PDFs típicos de 1–5 páginas
- [ ] Medir separadamente o caminho com **OCR** — `ocrService.js` renderiza até 20 páginas a 180 DPI com timeout de 60 s; o alvo de 30 s não se aplica aqui. Definir e documentar um SLA próprio para OCR
- [ ] Build do Vite servido com gzip, < 200 KB transferidos
- [ ] Teste de carga: 10 usuários simultâneos gerando análises sem erro
- [ ] **Avaliar separar o worker do processo da API.** Hoje `backend/server.js` importa `src/worker.js`, então um OCR pesado disputa CPU com o atendimento HTTP no mesmo processo Node. O plano previa serviço separado (tabela comparativa §1 do `implementation-plan.md`)

## FL.3 — Checklist de Resiliência

- [ ] Restart do backend não perde jobs pendentes (BullMQ persiste no Redis)
- [ ] Asaas fora do ar não derruba a aplicação — `AsaasError` deve virar 502 tratado
- [ ] Falha no meio da análise → estorno automático funciona (`refundCredit` em `analysisWorker.js:96`)
- [ ] Webhook idempotente: reenviar o mesmo evento não duplica créditos nem pagamentos
- [ ] Restart de containers sem downtime
- [ ] Mutex por tenant é liberado mesmo em caso de crash — validar o TTL do lock em `analysisWorker.js` (`finally` chama `releaseLock`, mas um `SIGKILL` depende só do TTL)

## FL.4 — Monitoramento Básico

- [ ] `GET /health/ready` verificando DB + Redis e devolvendo 503 na falha (implementado em `backend/server.js:96` — validar em produção)
- [ ] Healthcheck do Railway apontando corretamente (`railway.json`)
- [ ] Definir onde os logs são lidos e por quanto tempo ficam retidos
- [ ] Alerta para jobs falhados na BullMQ (`removeOnFail: 100` guarda as últimas falhas — definir quem olha e com que frequência)
- [ ] Alerta de erro no worker de e-mail — hoje falhas só aparecem em `console.error`

## FL.5 — Smoke Tests Pós-Deploy

- [ ] Executar `backend/scripts/smoke-test.sh` contra a URL de produção
- [ ] Conferir se o script cobre: health, registro, login, saldo (trial = 3 créditos)
- [ ] Estender para o caminho crítico: `POST /analyze` → polling de status → `GET /result` → `GET /pdf`
- [ ] Garantir limpeza dos dados de teste ao final (`backend/scripts/clean-test-data.js` existe)
- [ ] Amarrar a execução ao processo de deploy — script que ninguém roda não protege nada

---

# Bloco 4 — Backlog (Fase 3 do PRD, pós-launch)

## B1 — Programa de indicação (RF-21) ⚪

**Estado:** schema-only. `Tenant.referredBy`, `Tenant.referralBonuses`, `referralCode` e `NotificationType.REFERRAL_CONVERTED` existem em `backend/prisma/schema.prisma`, mas nada escreve ou lê esses campos — `referralCode` aparece somente num `select` em `backend/src/controllers/adminController.js:205`. Zero endpoints, zero lógica de bônus.

- [ ] Definir a regra de negócio (PRD sugere: 1 mês grátis por conversão)
- [ ] Gerar `referralCode` no registro do tenant
- [ ] Aceitar código de indicação em `POST /auth/register` e gravar `referredBy`
- [ ] Creditar o bônus no evento de conversão (primeiro pagamento confirmado, em `webhookProcessor.js`) — não no cadastro, para não premiar cadastro fantasma
- [ ] Disparar a notificação `REFERRAL_CONVERTED` (depende do template de L6)
- [ ] Tela do cliente com link de indicação e status das conversões
- [ ] `GET /admin/referrals` (previsto no plano, não implementado)

## B2 — Excedente removido, avulso com desconto no lugar — ✅ (24/07/2026)

**Decisão:** o excedente (RF-12 do PRD) foi **descontinuado** sem nunca ter sido implementado.

**Estado que motivou a remoção:** `PaymentType.EXCESS` e `Plan.excessPriceBrl` existiam desde a `0_init`, mas **nenhuma linha de código criava um pagamento de excedente** — estourar a franquia apenas devolvia 402 em `backend/src/middleware/creditGuard.js`. Pior que código morto: a promessa estava **anunciada ao cliente** em três preços diferentes e mutuamente incompatíveis:

| Onde | O que prometia |
|---|---|
| `docs/saas/prd.md:65` | R$ 7,90/laudo, "cobrado no cartão ao final do ciclo" |
| `frontend/src/pages/Plans.jsx:216` | "Excedente: R$ 7,90/laudo" no card de plano, ao assinante |
| `frontend/src/pages/Landing.jsx:222` | "R$ 13 por laudo excedente" na vitrine pública |

**Por que remover em vez de implementar:**

1. **O avulso já resolve o caso de uso.** `POST /billing/avulso` (R$ 79) atende "preciso de mais um laudo" sem cobrança postergada, sem saldo devedor e sem risco de fatura-surpresa.
2. **A cobrança no fechamento do ciclo não tem infraestrutura.** `backend/src/jobs/webhookProcessor.js` só sabe processar a mensalidade fixa da assinatura Asaas. Seria preciso acumular consumo excedente no ciclo, emitir cobrança adicional na virada e tratar a falha dela — que hoje dispararia o fluxo de suspensão desenhado para inadimplência de assinatura.
3. **Risco de consumidor.** Cobrança automática sem consentimento explícito por laudo é exposição desnecessária, e advogado é o cliente que menos perdoa fatura-surpresa.

### O que foi removido

- [x] `Plan.excessPriceBrl` e `PaymentType.EXCESS` — `backend/prisma/schema.prisma`
- [x] Migration `20260724120000_remove_excess_billing` — drop da coluna + recriação do enum, abortando se houver `payments` com `type='EXCESS'` (registro financeiro não se converte em silêncio)
- [x] 5 ocorrências de `excessPriceBrl` + comentário de cabeçalho — `backend/prisma/seed.js`
- [x] Campo `excessPriceBrl` do `updatePlanSchema` — `backend/src/controllers/adminMetricsController.js`
- [x] Card de plano do assinante — `frontend/src/pages/Plans.jsx` (substituído por espaçador, preservando o alinhamento dos botões)
- [x] Item "R$ 13 por laudo excedente" — `frontend/src/pages/Landing.jsx`
- [x] Comentário `// AVULSO ou EXCESS` — `backend/src/jobs/webhookProcessor.js`

**Preservado de propósito:** `backend/prisma/migrations/0_init/migration.sql` (histórico de migration não se reescreve) e a mensagem em `backend/src/controllers/billingController.js:243`, que trata de **usuários** excedentes num downgrade de plano — assunto diferente.

### O que entrou no lugar: avulso com desconto para assinante ✅

Implementado em 24/07/2026. Resolve o mesmo problema comercial do excedente — o assinante que estoura a franquia não precisa pagar R$ 79 (10× o custo unitário do plano) nem subir de plano por causa de um laudo — mas **à vista, pelo fluxo `/billing/avulso` que já existia**: sem saldo devedor, sem cobrança postergada, sem fatura-surpresa.

**Regra:** assinante com status `ACTIVE` compra o laudo avulso pelo preço promocional do próprio plano, limitado a N compras por ciclo de faturamento. Esgotado o limite, volta ao preço cheio; o benefício zera na renovação.

**Preços iniciais** (`backend/prisma/seed.js`, todos editáveis no admin sem deploy):

| Plano | Mensalidade | Custo/laudo | Avulso assinante | Limite/ciclo |
|---|---|---|---|---|
| *(sem assinatura)* | — | — | R$ 79,00 | — |
| Inicial | R$ 197 | R$ 13,13 | R$ 49,00 | 1 |
| Profissional | R$ 297 | R$ 7,43 | R$ 39,00 | 1 |
| Escritório | R$ 597 | R$ 4,98 | R$ 29,00 | 1 |
| Massa | R$ 1.990 | R$ 3,98 | R$ 19,00 | 1 |
| Fundador | R$ 197 | R$ 4,93 | R$ 39,00 | 1 |

O gradiente é proposital: plano melhor = avulso mais barato, para que subir de plano continue valendo mais que acumular avulsos. Todos os valores ficam **acima** do custo por laudo do próprio plano — abaixo disso o avulso canibalizaria o upgrade.

**Implementação:**

- `Plan.avulsoPriceBrl` (null = sem desconto) e `Plan.avulsoDiscountLimit` (default 1) — `backend/prisma/schema.prisma`
- `Payment.avulsoDiscounted` — marca a compra que consumiu vaga no ciclo. Gravado explicitamente em vez de inferido do valor pago: o preço do plano muda com o tempo e a contagem ficaria errada retroativamente
- Migration `20260724130000_add_discounted_avulso`, com índice `(tenantId, avulsoDiscounted, createdAt)` para a contagem do ciclo
- `resolveAvulsoPricing(tenantId)` — `backend/src/controllers/billingController.js`, fonte única do preço. Usada na compra (para cobrar) e em `GET /billing/subscription` (para a tela anunciar), garantindo que as duas concordem
- Mutex Redis `avulsoLockKey` — `backend/src/utils/lock.js`. Sem ele, duas compras simultâneas contam o limite antes de qualquer uma gravar seu pagamento e ambas levam o preço promocional
- Admin edita preço e limite por plano — `frontend/src/pages/admin/AdminPlans.jsx` + `updatePlanSchema` em `adminMetricsController.js`
- Tela do cliente mostra preço vigente, preço cheio riscado, selo "preço de assinante" e quantas compras com desconto restam — `frontend/src/pages/Plans.jsx`

**Decisões de borda registradas:**

- **`OVERDUE` não tem desconto.** O benefício acompanha a assinatura em dia; o inadimplente já recebe créditos de emergência pelo fluxo de cobrança e não deve acumular vantagem por cima
- **Cobrança `PENDING` consome a vaga.** Se só `PAID` contasse, daria para abrir N cobranças promocionais antes de pagar a primeira e furar o limite. Cobrança cancelada devolve a vaga
- **Fundador usa o mesmo preço do Profissional.** O benefício de fundador já está na mensalidade travada por 12 meses, não se acumula aqui
- O audit log de cada compra grava `discounted`, `discountLimit` e `discountUsedBefore` — se o admin mudar preço ou limite depois, o registro continua explicando por que aquele valor foi cobrado

### Pendências

- [ ] Atualizar `docs/saas/prd.md`: a linha "Excedente" da tabela 3.2 (`:61`), a regra do `:65`, o RF-12 (`:229-236`), o Fluxo 3 (`:392-397`) e `'excess'` do CHECK em `:515` — substituir pela regra do avulso com desconto, registrando como decisão revista em vez de apagar o histórico
- [ ] Ao construir o modal de 100% da franquia (hoje inexistente — `creditGuard` devolve 402 direto), oferecer duas opções: upgrade de plano ou avulso com desconto, já exibindo o preço vindo de `resolveAvulsoPricing`
- [ ] Confirmar os preços do gradiente antes do launch — os valores do seed são proposta, não decisão fechada
- [ ] Avaliar notificar o assinante quando o desconto do ciclo é reposto na renovação (hoje ele descobre ao abrir a tela)

> Se o excedente com saldo devedor for retomado algum dia, refazer do zero com **opt-in explícito por laudo** e **teto por ciclo** — não reativar os campos removidos.

## B3 — Migrar geocodificação para LocationIQ ⚪

**Estado atual:** `backend/src/services/geocodingService.js` usa AwesomeAPI (CEP-first) com fallback Nominatim; `staticMapService.js` usa Geoapify. Todos gratuitos, com limites de uso e sem SLA.

- [ ] Avaliar volume real de geocodificação após os fundadores, antes de pagar por provedor
- [ ] Contratar LocationIQ e trocar a implementação **por trás da interface existente** de `geocodingService.js` (manter `precision` e `cityMatch` no retorno, consumidos por `geoEnrichmentService.js`)
- [ ] Preservar o fallback — um laudo forense não pode falhar porque um provedor externo caiu
- [ ] Confirmar se `GEOAPIFY_KEY` (mapa estático do PDF) também precisa de plano pago

---

# Ordem de execução sugerida

```
BLOQUEADORES COMERCIAIS  (destrava a receita)
├── L1  ✅ Fluxo Fundador end-to-end (24/07/2026)
├── L2  Aceite de convite de equipe        ← sem isto Escritório/Massa não fecham
├── L3  Preços da Landing dinâmicos        ← risco jurídico enquanto durar
└── L4  Métricas reais no Dashboard

HARDENING  (pré-requisito de produção)
├── FL.1  Segurança — com foco em tenant isolation e ASAAS_WEBHOOK_IPS
├── FL.3  Resiliência — idempotência de webhook e estorno
├── FL.5  Smoke tests contra produção
├── FL.2  Performance — decidir sobre worker separado
└── FL.4  Monitoramento

🚀 LAUNCH FUNDADORES — abertura das 25 vagas

DÍVIDAS  (pós-launch, sem pressa)
├── L6  Templates + asserção de completude do enum
├── L5  Histórico de pagamentos
├── L7  Remover /v2
├── L8  Onboarding server-side
└── L9  Higiene e documentação

BACKLOG FASE 3
├── B1  Programa de indicação
├── B2  ✅ Avulso com desconto (24/07/2026) — resta limpar o PRD
├── B3  LocationIQ
└── Migração Railway → VPS  (escrever a seção 13 ausente do plano)
```

**Caminho crítico até receita:** L1 → L2 → L3 → FL.1 → FL.5 → Launch.

---

*Levantamento por auditoria de código em 24/07/2026 sobre o commit `c0a6cf9`. Atualizar os checkboxes conforme a execução; quando um bloco fechar, registrar o commit correspondente.*
