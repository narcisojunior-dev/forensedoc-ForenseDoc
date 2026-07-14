# ForenseDoc v3.0 — Plano de Implementação

> **Baseado em:** PRD v3.0 (decisões de produto definidas)  
> **Data:** Julho de 2026  
> **Stack:** Node.js + Express · PostgreSQL · React/Vite · Asaas  
> **Infra de Lançamento:** Railway (rápido para validar com fundadores)  
> **Infra de Produção:** VPS dedicada Ubuntu + Docker (migração antes da abertura pública)

> [!IMPORTANT]
> **Estratégia de Infra em duas etapas:** O sistema é desenvolvido e lançado para os Fundadores usando **Railway** (setup em horas, sem gerenciar servidor). Após validar o produto com os primeiros 25 usuários, **toda a aplicação é migrada para VPS dedicada** antes da abertura pública (Fase 2). O código da aplicação **não muda** entre os ambientes — apenas as variáveis de ambiente e o Docker Compose.

---

## Índice

1. [Visão da Arquitetura](#1-visão-da-arquitetura)
2. [Princípios de Segurança](#2-princípios-de-segurança-transversais)
3. [Princípios de Escalabilidade](#3-princípios-de-escalabilidade-transversais)
4. [Fase 0 — Infraestrutura Railway (Lançamento)](#fase-0--infraestrutura-railway-lançamento)
5. [Módulo 1 — Auth & Multi-tenant](#módulo-1--auth--multi-tenant)
6. [Módulo 2 — Credits Engine](#módulo-2--credits-engine)
7. [Módulo 3 — Billing / Asaas](#módulo-3--billing--asaas)
8. [Módulo 4 — Motor de Análise (v2.2 → v3.0)](#módulo-4--motor-de-análise-v22--v30)
9. [Módulo 5 — Frontend](#módulo-5--frontend)
10. [Módulo 6 — Admin Panel](#módulo-6--admin-panel)
11. [Módulo 7 — Notificações](#módulo-7--notificações)
12. [Fase Final — Hardening & Launch](#fase-final--hardening--launch)
13. [Migração Railway → VPS (Antes da Abertura Pública)](#migração-railway--vps-antes-da-abertura-pública)
14. [Ordem de Execução Resumida](#14-ordem-de-execução-resumida)

---

## 1. Visão da Arquitetura

### Fase de Lançamento — Railway (Fundadores)

```
┌────────────────────────────────────────────────────────────────────┐
│                         RAILWAY (cloud)                             │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │   backend        │  │  PostgreSQL 16   │  │   Redis           │  │
│  │ (Node/Express)   │  │ (Railway plugin) │  │ (Railway plugin)  │  │
│  │   + worker       │  │                  │  │                   │  │
│  └────────┬─────────┘  └──────────────────┘  └──────────────────┘  │
│           │  HTTPS automático (Railway domain)                       │
└───────────┼────────────────────────────────────────────────────────┘
            │
┌───────────▼──────────────────────────────────────────┐
│              Vercel / Netlify (Frontend React)         │
│              (deploy automático via git push)          │
└──────────────────────────────────────────────────────┘
                     │ APIs + Webhooks
          ┌──────────┴──────────┐
          ▼                     ▼
      Asaas API           Geo/IP Services
```

### Fase de Produção — VPS Dedicada (Abertura Pública)

> [!IMPORTANT]
> **Esta é a arquitetura alvo.** Todo o código da aplicação é idêntico — apenas a infraestrutura muda. A migração ocorre antes da abertura pública (entre Fase 1 e Fase 2 do roadmap).

```
┌────────────────────────────────────────────────────────────────────┐
│                          VPS Ubuntu LTS                             │
│                                                                      │
│  ┌──────────┐   ┌────────────────────────────────────────────────┐ │
│  │  Nginx   │   │            Docker Compose                       │ │
│  │  :443    │──▶│  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │ │
│  │  :80     │   │  │ backend  │  │ postgres │  │    redis    │  │ │
│  │(TLS/CSP) │   │  │ :8787    │  │ :5432    │  │   :6379     │  │ │
│  └──────────┘   │  └────┬─────┘  └──────────┘  └─────────────┘  │ │
│  Certbot/HSTS   │  ┌────▼──────┐ ┌──────────┐                    │ │
│                 │  │bull-worker│ │ pg-backup│                    │ │
│                 │  └───────────┘ │  (cron)  │                    │ │
│                 │                └──────────┘                    │ │
│                 └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                       ▼
     Frontend (React)         Asaas API           Geo/IP Services
     (Vite build → Nginx)   (Webhooks → backend)  (Nominatim/LocationIQ)
```

### Comparativo de Camadas por Ambiente

| Camada | Railway (lançamento) | VPS/Produção |
|--------|---------------------|-------------|
| **TLS / Proxy** | Railway automático | Nginx + Certbot |
| **Frontend** | Vercel/Netlify | Nginx (estáticos) |
| **API** | Railway Service (Node) | Docker container |
| **Worker (BullMQ)** | Railway Service separado | Docker container |
| **PostgreSQL** | Railway Plugin | Docker + volume |
| **Redis** | Railway Plugin | Docker + volume |
| **Backups** | Railway backups (automático) | `pg_dump` cron → armazenamento externo |
| **Headers de segurança** | Middleware Express (Helmet) | Nginx (melhor performance) |
| **Rate limit** | `express-rate-limit` + Redis | Idem |
| **Custo estimado** | ~US$ 20–40/mês | ~R$ 80–150/mês (VPS BR) |

---

## 2. Princípios de Segurança (Transversais)

Estes princípios se aplicam a **todos os módulos**. Cada módulo deve implementá-los sem exceção.

### 2.1 Autenticação e Autorização

| Medida | Implementação |
|--------|--------------|
| Senhas | `bcrypt` com salt rounds ≥ 12 |
| Tokens de acesso | JWT com expiração curta (15 min) |
| Refresh tokens | Opaque token armazenado em banco, rotacionado a cada uso |
| Revogação de tokens | Lista de refresh tokens inválidos no Redis (blacklist) |
| Multi-tenant RBAC | Middleware valida `tenant_id` + `role` em toda rota protegida |
| Admin routes | Prefixo `/admin` com middleware separado verificando `is_platform_admin` |

### 2.2 Isolamento de Dados (Multi-Tenant)

```js
// REGRA: toda query ao banco usa o tenant_id do JWT
// Exemplo de middleware obrigatório:
function tenantGuard(req, res, next) {
  const tenantId = req.auth.tenantId; // extraído do JWT verificado
  req.tenantId = tenantId;            // disponível em toda a cadeia
  next();
}

// REGRA: nunca confiar em tenant_id enviado pelo cliente no body
// ❌ const { tenantId } = req.body;
// ✅ const tenantId = req.tenantId; // do JWT
```

### 2.3 Validação de Entrada

- Toda entrada de usuário validada com **Zod** antes de tocar o banco
- Erros de validação retornam 400 com mensagem genérica (sem stack trace)
- Tamanho máximo do PDF: **30 MB** (verificado no middleware, antes do processamento)
- Content-type do upload verificado por magic bytes (não apenas extensão)

### 2.4 Rate Limiting

| Endpoint | Limite | Janela |
|---------|--------|--------|
| `POST /auth/login` | 10 tentativas | 15 min por IP |
| `POST /auth/register` | 5 registros | 1 hora por IP |
| `POST /auth/forgot-password` | 3 requisições | 1 hora por IP |
| `POST /api/analyze` | 1 análise | 30 seg por tenant (anti-duplo clique) |
| `POST /webhooks/asaas` | 100 req | 1 min por IP (Asaas IPs allowlisted) |
| Geral autenticado | 200 req | 1 min por `tenant_id` |

Implementação: `express-rate-limit` + `rate-limit-redis` (store compartilhada entre instâncias).

### 2.5 Cabeçalhos de Segurança HTTP

Configurados no Nginx (não no Express, para performance):

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data: tile.openstreetmap.org; connect-src 'self'" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

### 2.6 Proteção de Webhooks

- Validar `asaas-access-token` em todo webhook recebido
- Rejeitar IPs fora do range da Asaas (allowlist de CIDRs da Asaas)
- Idempotência: registrar `asaas_payment_id` como UNIQUE — reprocessamento seguro

### 2.7 Secrets e Configuração

```
# .env — NUNCA comitado no git
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=<256-bit aleatório>
JWT_REFRESH_SECRET=<256-bit aleatório diferente>
ASAAS_API_KEY=...
ASAAS_WEBHOOK_TOKEN=...
ADMIN_EMAIL=...
SMTP_HOST=...
```

- `.env` listado no `.gitignore`
- Secrets rotacionados a cada 90 dias (procedimento documentado)
- Em produção: secrets injetados como variáveis de ambiente no Docker Compose (não em arquivo)

### 2.8 Auditoria

Todo evento sensível registrado na tabela `audit_logs`:

```sql
audit_logs (
  id UUID,
  tenant_id UUID,
  user_id UUID,
  action TEXT,   -- 'login', 'analysis_started', 'credit_spent', 'payment_received', etc.
  ip_address INET,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ
)
```

---

## 3. Princípios de Escalabilidade (Transversais)

### 3.1 Backend Stateless

- Nenhuma sessão armazenada na memória do processo Node
- JWT contém todas as claims necessárias para autorização
- Múltiplas instâncias do backend podem rodar em paralelo sem conflito
- Estado compartilhado (saldo de créditos, blacklist de tokens) sempre no Redis ou PostgreSQL

### 3.2 Processamento Assíncrono com BullMQ

Operações pesadas nunca bloqueiam a API:

| Operação | Síncrona ou Assíncrona |
|----------|----------------------|
| Análise de PDF (OCR + extração) | **Assíncrona** (job BullMQ) |
| Envio de e-mail | **Assíncrona** (job BullMQ) |
| Processamento de webhook Asaas | **Assíncrona** (job BullMQ) |
| Expiração de créditos mensais | **Cron job** (BullMQ scheduler) |
| Login, CRUD simples | Síncrona (rápido) |

```
POST /api/analyze
  → valida crédito (síncrono, rápido)
  → debita crédito atomicamente (PostgreSQL transaction)
  → enfileira job BullMQ: { analysisId, pdfBuffer, userId, tenantId }
  → retorna 202 Accepted { jobId }

Frontend polling / WebSocket:
  GET /api/analyze/:jobId/status
  → retorna { status: 'processing' | 'completed' | 'error', result? }
```

### 3.3 Connection Pool PostgreSQL

```js
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // connection pool via DATABASE_URL: ?connection_limit=10&pool_timeout=20
}
```

Para escala maior: adicionar **PgBouncer** na frente do PostgreSQL (transaction pooling).

### 3.4 Cache Redis para Saldo de Créditos

```js
// Saldo em cache — TTL curto (30s) para consistência eventual aceitável
const CREDIT_CACHE_KEY = (tenantId) => `credits:${tenantId}`;
const CREDIT_CACHE_TTL = 30; // segundos

async function getCreditBalance(tenantId) {
  const cached = await redis.get(CREDIT_CACHE_KEY(tenantId));
  if (cached) return JSON.parse(cached);
  const balance = await db.creditBalance.findUnique({ where: { tenantId } });
  await redis.setex(CREDIT_CACHE_KEY(tenantId), CREDIT_CACHE_TTL, JSON.stringify(balance));
  return balance;
}

// Ao debitar crédito: invalida cache imediatamente
async function invalidateCreditCache(tenantId) {
  await redis.del(CREDIT_CACHE_KEY(tenantId));
}
```

### 3.5 Índices de Banco de Dados

```sql
-- Performance crítica: toda query filtra por tenant_id
CREATE INDEX idx_analyses_tenant_created ON analyses(tenant_id, created_at DESC);
CREATE INDEX idx_credit_transactions_tenant ON credit_transactions(tenant_id, created_at DESC);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id, status);
CREATE INDEX idx_payments_asaas_id ON payments(asaas_payment_id); -- idempotência webhook

-- Auth
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_tenants_cpf_cnpj ON tenants(cpf_cnpj);
```

### 3.6 Escalabilidade Horizontal (Futuro)

A arquitetura já suporta escalar sem reescrever:

- **Mais instâncias do backend**: stateless + Redis compartilhado → adicionar mais containers (ou mais Railway instances)
- **Mais workers de análise**: BullMQ com concorrência configurável por container
- **Banco de leitura**: adicionar réplica read-only do PostgreSQL para queries do Admin Panel
- **CDN para frontend**: Vercel/Netlify já entregam via CDN; na VPS, Nginx serve estáticos → mover para CDN sem mudança no backend

### 3.7 Portabilidade Railway → VPS

O código é idêntico nos dois ambientes. A portabilidade é garantida por:

- **Variáveis de ambiente** como única diferença entre ambientes (12-factor app)
- **Prisma migrations** rodadas no deploy — schema sempre atualizado
- **Docker Compose** preparado desde o início (mesmo que Railway não use Docker, o compose garante que o código roda igual em qualquer servidor)
- **Sem dependência de serviços exclusivos do Railway** — PostgreSQL e Redis são padrão, não serviços proprietários

---

## Fase 0 — Infraestrutura Railway (Lançamento)

> **Duração estimada:** 2–3 horas (vs. 1 semana de VPS)  
> **Objetivo:** Ter backend, banco e cache rodando em produção o mais rápido possível para validar com os fundadores  
> **⚠️ Temporário:** Esta infra suporta o lançamento com fundadores. A migração para VPS dedicada ocorre antes da abertura pública.

### Por que Railway agora?

| Critério | Railway | VPS própria |
|----------|---------|------------|
| Tempo de setup | **~2 horas** | ~1 semana |
| Gerenciamento de servidor | Nenhum | Alto (SSH, Docker, Nginx, Certbot...) |
| TLS automático | ✅ Incluso | Manual (Certbot) |
| PostgreSQL gerenciado | ✅ Plugin | Manual |
| Redis gerenciado | ✅ Plugin | Manual |
| Custo (fundadores) | ~US$ 20–40/mês | ~R$ 80–150/mês |
| Adequado para escala > 200 usuários | ⚠️ Rever | ✅ Total controle |

### F0.1 — Criar Projeto no Railway

**Tarefas:**

- [ ] Criar conta em [railway.app](https://railway.app) e criar novo projeto `forensedoc`
- [ ] Adicionar plugin **PostgreSQL 16** — Railway provisiona automaticamente e expõe `DATABASE_URL`
- [ ] Adicionar plugin **Redis** — Railway provisiona automaticamente e expõe `REDIS_URL`
- [ ] Anotar as connection strings geradas pelo Railway para usar nas variáveis de ambiente

**Segurança:**
- Railway isola os serviços internamente (PostgreSQL e Redis não são acessíveis externamente por padrão)
- Usar a `DATABASE_URL` fornecida pelo Railway — nunca hardcodar credenciais

### F0.2 — Deploy do Backend no Railway

- [ ] Conectar repositório Git ao Railway (GitHub integration)
- [ ] Configurar serviço **backend**: `npm start` (ou `node server.js`)
- [ ] Configurar serviço **worker**: `node src/worker.js` (serviço separado, mesmo repositório, variável `WORKER_MODE=true`)
- [ ] Configurar todas as variáveis de ambiente no painel do Railway (ver Apêndice)
- [ ] Railway gera automaticamente um domínio `*.up.railway.app` com HTTPS
- [ ] Configurar domínio personalizado (`api.forensedoc.com.br`) no Railway → apontar DNS

**Segurança no Railway:**
- Adicionar `helmet` (middleware Express) para headers de segurança HTTP — no Railway não há Nginx para isso
- Configurar CORS para aceitar apenas o domínio do frontend
- Variáveis de ambiente gerenciadas pelo painel Railway (nunca em arquivos `.env` commitados)

```js
// src/app.js — adicionar helmet para headers de segurança no Railway
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "tile.openstreetmap.org"],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
```

### F0.3 — Banco de Dados e Schema (Railway PostgreSQL)

- [ ] Inicializar Prisma no projeto backend
- [ ] Criar schema Prisma completo (todas as entidades do PRD + `audit_logs`)
- [ ] Rodar migration inicial: `railway run npx prisma migrate deploy`
- [ ] Criar índices de performance (via migration Prisma, listados na Seção 3.5)
- [ ] Configurar Redis com senha — Railway já configura, usar a URL fornecida
- [ ] Habilitar backups automáticos do PostgreSQL no painel Railway (disponível nos planos pagos)

**Segurança:**
- Railway usa SSL nas conexões ao PostgreSQL por padrão (`?sslmode=require` na connection string)
- Ativar backup automático do Railway para o PostgreSQL (snapshots diários)
- Para redundância adicional: script semanal de `pg_dump` para bucket externo (Backblaze B2 ou Google Cloud Storage)

### F0.4 — Deploy do Frontend (Vercel ou Netlify)

- [ ] Criar projeto no **Vercel** (recomendado para React/Vite) ou Netlify
- [ ] Conectar repositório Git → deploy automático a cada `git push`
- [ ] Configurar variável de ambiente `VITE_API_BASE_URL=https://api.forensedoc.com.br`
- [ ] Configurar domínio `forensedoc.com.br` → apontar DNS para Vercel/Netlify
- [ ] HTTPS automático incluído (Let's Encrypt gerenciado pela Vercel/Netlify)

### F0.5 — CI/CD no Railway

- [ ] Configurar **deploy automático** no Railway: a cada push para a branch `main`, Railway faz build e deploy
- [ ] Configurar **run on deploy**: `npx prisma migrate deploy` (roda migrations antes de subir o serviço)
- [ ] Configurar **health check**: Railway verifica `GET /health` e reinicia o serviço se falhar

```json
// railway.json (na raiz do backend)
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**Entregável da Fase 0:** Backend rodando no Railway com HTTPS automático, PostgreSQL e Redis provisionados, frontend no Vercel. Em ~3 horas o sistema está acessível via domínio próprio com TLS.

---

## Módulo 1 — Auth & Multi-Tenant

> **Fase:** 0 → 1  
> **Duração estimada:** 1,5 semanas  
> **Dependências:** Fase 0 completa

### M1.1 — Schema de Auth e Tenant

**Novas tabelas Prisma:**

```prisma
model Tenant {
  id         String   @id @default(uuid())
  name       String
  cpfCnpj    String   @unique
  oabNumber  String?
  oabState   String?  @db.Char(2)
  status     TenantStatus @default(TRIAL)
  createdAt  DateTime @default(now())

  users         User[]
  subscription  Subscription?
  creditBalance CreditBalance?
  analyses      Analysis[]
  creditTx      CreditTransaction[]
  payments      Payment[]
  referralCode  String   @unique @default(cuid())
}

model User {
  id           String   @id @default(uuid())
  tenantId     String
  email        String   @unique
  name         String
  passwordHash String
  role         UserRole @default(MEMBER)
  oabNumber    String?
  emailVerified Boolean @default(false)
  lastLoginAt  DateTime?
  createdAt    DateTime @default(now())
  
  tenant    Tenant     @relation(fields: [tenantId], references: [id])
  analyses  Analysis[]
  creditTx  CreditTransaction[]
}

model EmailVerification {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique  // hash do token (nunca guardar o token cru)
  expiresAt DateTime
  revoked   Boolean  @default(false)
  createdAt DateTime @default(now())
}

model PasswordReset {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

### M1.2 — Endpoints de Auth

```
POST /auth/register
POST /auth/verify-email
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/forgot-password
POST /auth/reset-password
GET  /auth/me
```

**Implementação de segurança por endpoint:**

#### `POST /auth/register`
- Rate limit: 5/hora por IP
- Validar com Zod: email, senha (mín 8 chars, 1 maiúscula, 1 número), OAB, CPF/CNPJ
- Verificar unicidade de e-mail e CPF/CNPJ (em transação)
- Hash da senha com `bcrypt` (rounds: 12)
- Criar tenant + user + creditBalance (com 3 créditos trial) em **única transação**
- Enviar e-mail de verificação (token UUID, expira em 24h, armazenado como hash SHA-256)
- **Não logar o usuário ainda** — exigir verificação de e-mail primeiro

#### `POST /auth/login`
- Rate limit: 10/15 min por IP + 5/15 min por e-mail (dois limitadores)
- Verificar e-mail existe → verificar senha (bcrypt.compare) → verificar e-mail confirmado
- Gerar access token (JWT, 15 min, claims: `userId`, `tenantId`, `role`, `tenantStatus`)
- Gerar refresh token (UUID opaque, 30 dias, armazenar hash SHA-256 no banco)
- Retornar access token no body; refresh token em `HttpOnly, Secure, SameSite=Strict` cookie
- Registrar `last_login_at` e IP no audit log

#### `POST /auth/refresh`
- Ler refresh token do cookie `HttpOnly`
- Verificar hash no banco (não revogado, não expirado)
- Rotacionar: revogar token atual, emitir novo par (access + refresh)
- Se token já foi usado antes (detectado por revogação): **revogar TODOS os refresh tokens do usuário** (possível roubo de token)

#### `POST /auth/logout`
- Revogar refresh token atual no banco
- Adicionar access token no Redis blacklist (até seu TTL expirar)
- Limpar cookie

### M1.3 — Middleware de Autenticação

```js
// src/middleware/auth.js
export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  
  // Verificar blacklist no Redis
  const revoked = await redis.get(`blacklist:${token}`);
  if (revoked) return res.status(401).json({ error: 'Token revogado.' });
  
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  req.auth = payload; // { userId, tenantId, role, tenantStatus }
  
  // Verificar status do tenant (não suspender mid-request)
  if (payload.tenantStatus === 'SUSPENDED') {
    return res.status(403).json({ error: 'Conta suspensa.', code: 'ACCOUNT_SUSPENDED' });
  }
  
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: 'Sem permissão.' });
    next();
  };
}

export function requirePlatformAdmin(req, res, next) {
  if (!req.auth.isPlatformAdmin) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
}
```

### M1.4 — Convite de Membros (Planos Escritório/Massa)

```
POST /tenant/invite        → owner convida membro por e-mail
GET  /tenant/invite/:token → membro aceita convite
GET  /tenant/members       → lista membros do tenant
DELETE /tenant/members/:id → remove membro
```

- Convite tem token único (UUID) e expira em 72h
- Ao aceitar: cria novo `User` vinculado ao `tenantId` do convite
- Validar limite de usuários conforme plano antes de enviar convite
- Apenas `OWNER` pode convidar e remover membros

**Entregável do Módulo 1:** Cadastro, login, JWT, refresh, verificação de e-mail, convite de membros funcionando. Todos os endpoints protegidos por middleware.

---

## Módulo 2 — Credits Engine

> **Fase:** 1  
> **Duração estimada:** 1 semana  
> **Dependências:** Módulo 1 completo

### M2.1 — Schema de Créditos

```prisma
model CreditBalance {
  id               String   @id @default(uuid())
  tenantId         String   @unique
  creditsMonthly   Int      @default(0)   // expira no ciclo
  creditsAvulso    Int      @default(0)   // sem validade
  creditsEmergency Int      @default(0)   // expira ao regularizar pagamento
  creditsManual    Int      @default(0)   // concedidos pelo admin
  cycleStart       DateTime?
  cycleEnd         DateTime?
  updatedAt        DateTime @updatedAt
  
  tenant Tenant @relation(fields: [tenantId], references: [id])
}

model CreditTransaction {
  id         String              @id @default(uuid())
  tenantId   String
  userId     String?
  type       CreditTransactionType
  amount     Int                 // positivo = entrada, negativo = saída
  source     String              // 'subscription_renewal', 'avulso_purchase', etc.
  analysisId String?
  notes      String?
  createdAt  DateTime            @default(now())
  
  tenant   Tenant    @relation(fields: [tenantId], references: [id])
  user     User?     @relation(fields: [userId], references: [id])
  analysis Analysis? @relation(fields: [analysisId], references: [id])
}

enum CreditTransactionType {
  EARN_MONTHLY
  EARN_AVULSO
  EARN_EMERGENCY
  EARN_MANUAL
  SPEND
  EXPIRE
  REFUND
}
```

### M2.2 — Credit Service (Núcleo)

```js
// src/services/creditService.js

// Verificar saldo disponível
async function hasCredit(tenantId) {
  const balance = await getCreditBalance(tenantId); // com cache Redis
  return getTotalCredits(balance) > 0;
}

// Total disponível (prioridade: mensal → emergência → avulso)
function getTotalCredits(balance) {
  return balance.creditsMonthly + balance.creditsEmergency + balance.creditsAvulso;
}

// Debitar 1 crédito de forma atômica (PostgreSQL transaction)
// Ordem: mensal → emergência → avulso
async function debitCredit(tenantId, userId, analysisId, tx) {
  const balance = await tx.creditBalance.findUnique({
    where: { tenantId },
  });
  
  if (getTotalCredits(balance) < 1) {
    throw new Error('INSUFFICIENT_CREDITS');
  }

  let updateField;
  if (balance.creditsMonthly > 0) updateField = { creditsMonthly: { decrement: 1 } };
  else if (balance.creditsEmergency > 0) updateField = { creditsEmergency: { decrement: 1 } };
  else updateField = { creditsAvulso: { decrement: 1 } };
  
  await tx.creditBalance.update({ where: { tenantId }, data: updateField });
  await tx.creditTransaction.create({
    data: {
      tenantId, userId,
      type: 'SPEND',
      amount: -1,
      source: 'analysis',
      analysisId,
    }
  });
  
  await invalidateCreditCache(tenantId);
  await checkCreditAlerts(tenantId, balance); // disparar alertas se 80%/95%/100%
}

// Estornar crédito (em caso de erro no processamento)
async function refundCredit(tenantId, userId, analysisId) { ... }

// Adicionar créditos mensais (renovação de assinatura)
async function addMonthlyCredits(tenantId, amount, cycleStart, cycleEnd) { ... }

// Adicionar créditos avulsos (compra R$ 79)
async function addAvulsoCredit(tenantId, paymentId) { ... }

// Adicionar créditos de emergência (falha de pagamento)
async function addEmergencyCredits(tenantId) { ... }

// Expirar créditos mensais não utilizados (cron job)
async function expireMonthlyCredits(tenantId) { ... }
```

### M2.3 — Credit Guard Middleware

```js
// src/middleware/creditGuard.js
export async function requireCredit(req, res, next) {
  const { tenantId } = req.auth;
  const has = await creditService.hasCredit(tenantId);
  if (!has) {
    return res.status(402).json({
      error: 'Créditos insuficientes.',
      code: 'NO_CREDITS',
      balance: await creditService.getBalancePublic(tenantId),
    });
  }
  next();
}
```

### M2.4 — Alertas de Saldo

```js
// Gatilhos verificados após cada débito:
async function checkCreditAlerts(tenantId, balanceBefore) {
  const balance = await getCreditBalance(tenantId);
  const subscription = await getActiveSubscription(tenantId);
  if (!subscription) return;
  
  const totalMonthly = subscription.plan.creditsMonthly;
  const used = totalMonthly - balance.creditsMonthly;
  const pct = (used / totalMonthly) * 100;
  
  if (pct >= 100 && balanceBefore.creditsMonthly > 0) {
    await enqueueNotification(tenantId, 'CREDITS_EXHAUSTED');
  } else if (pct >= 95 && balanceBefore.creditsMonthly > Math.ceil(totalMonthly * 0.05)) {
    await enqueueNotification(tenantId, 'CREDITS_95PCT');
  } else if (pct >= 80 && balanceBefore.creditsMonthly > Math.ceil(totalMonthly * 0.20)) {
    await enqueueNotification(tenantId, 'CREDITS_80PCT');
  }
}
```

### M2.5 — Cron Job: Expiração de Créditos Mensais

```js
// src/jobs/expireCredits.js — rodado pelo BullMQ Scheduler
// Executa diariamente às 00:00
export async function expireCreditsForDueSubscriptions() {
  const dueSubscriptions = await db.subscription.findMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: { lte: new Date() },
    },
    include: { tenant: { include: { creditBalance: true } } },
  });
  
  for (const sub of dueSubscriptions) {
    await db.$transaction(async (tx) => {
      const balance = sub.tenant.creditBalance;
      if (balance.creditsMonthly > 0) {
        await tx.creditTransaction.create({
          data: {
            tenantId: sub.tenantId,
            type: 'EXPIRE',
            amount: -balance.creditsMonthly,
            source: 'cycle_end',
          }
        });
        await tx.creditBalance.update({
          where: { tenantId: sub.tenantId },
          data: { creditsMonthly: 0 },
        });
      }
    });
  }
}
```

**Endpoints de créditos:**

```
GET  /credits/balance      → saldo atual (mensal, avulso, emergência, manual)
GET  /credits/transactions → histórico de movimentações (paginado)
```

**Entregável do Módulo 2:** Credit Engine completo — verificação, débito atômico, estorno, alertas, expiração por cron.

---

## Módulo 3 — Billing / Asaas

> **Fase:** 1 → 2  
> **Duração estimada:** 1,5 semanas  
> **Dependências:** Módulo 2 completo

### M3.1 — Integração Asaas API

```js
// src/services/asaasService.js
const ASAAS_BASE = 'https://api.asaas.com/v3'; // produção
// const ASAAS_BASE = 'https://sandbox.asaas.com/api/v3'; // sandbox

async function asaasRequest(method, path, body) {
  const res = await fetch(`${ASAAS_BASE}${path}`, {
    method,
    headers: {
      'access_token': process.env.ASAAS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new AsaasError(err);
  }
  return res.json();
}

// Criar cliente na Asaas
export async function createAsaasCustomer(tenant) { ... }

// Criar assinatura recorrente
export async function createSubscription(customerId, planId, billingType, cycleType) { ... }

// Criar cobrança avulsa (R$ 79)
export async function createAvulsoPayment(customerId, amount, billingType) { ... }

// Cancelar assinatura
export async function cancelSubscription(asaasSubscriptionId) { ... }
```

### M3.2 — Webhook Handler

```
POST /webhooks/asaas
```

```js
// src/controllers/webhookController.js
export async function handleAsaasWebhook(req, res) {
  // 1. Validar token de acesso da Asaas
  const token = req.headers['asaas-access-token'];
  if (token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return res.status(401).end();
  }
  
  // 2. Responder 200 imediatamente (Asaas tem timeout curto)
  res.status(200).end();
  
  // 3. Enfileirar processamento assíncrono
  await webhookQueue.add('process-webhook', req.body, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

// src/jobs/webhookProcessor.js
export async function processWebhook(job) {
  const { event, payment, subscription } = job.data;
  
  switch (event) {
    case 'PAYMENT_RECEIVED':
      await handlePaymentReceived(payment);
      break;
    case 'PAYMENT_OVERDUE':
      await handlePaymentOverdue(payment);
      break;
    case 'SUBSCRIPTION_CANCELLED':
      await handleSubscriptionCancelled(subscription);
      break;
    // ...
  }
}

async function handlePaymentReceived(payment) {
  // Idempotência: verificar se já processamos este payment_id
  const existing = await db.payment.findUnique({
    where: { asaasPaymentId: payment.id }
  });
  if (existing?.status === 'PAID') return; // já processado, ignorar
  
  // Atualizar payment no banco
  await db.payment.update({ where: { asaasPaymentId: payment.id }, data: { status: 'PAID' } });
  
  // Identificar tenant pelo asaas_customer_id
  const tenant = await getTenantByAsaasId(payment.customer);
  
  // Carregar créditos mensais
  const plan = await getActivePlan(tenant.id);
  await creditService.addMonthlyCredits(tenant.id, plan.creditsMonthly, cycleStart, cycleEnd);
  
  // Expirar créditos de emergência se houver
  await creditService.expireEmergencyCredits(tenant.id);
  
  // Enfileirar notificação de confirmação
  await notificationQueue.add('payment-confirmed', { tenantId: tenant.id });
}

async function handlePaymentOverdue(payment) {
  const tenant = await getTenantByAsaasId(payment.customer);
  
  // Verificar se já concedemos emergência neste ciclo (idempotência)
  const alreadyGranted = await wasEmergencyGrantedThisCycle(tenant.id);
  if (!alreadyGranted) {
    await creditService.addEmergencyCredits(tenant.id);
    await notificationQueue.add('payment-failed', { tenantId: tenant.id });
  }
  
  // Agendar job de suspensão em 7 dias
  await suspensionQueue.add('suspend-if-overdue', { tenantId: tenant.id }, {
    delay: 7 * 24 * 60 * 60 * 1000, // 7 dias
  });
}
```

### M3.3 — Endpoints de Billing (self-service)

```
GET    /billing/plans              → lista planos disponíveis
POST   /billing/subscribe          → assinar plano (cria customer + sub no Asaas)
POST   /billing/avulso             → comprar 1 crédito avulso (R$ 79)
GET    /billing/subscription       → assinatura atual do tenant
POST   /billing/subscription/upgrade   → upgrade de plano
POST   /billing/subscription/cancel    → cancelar assinatura
GET    /billing/payments           → histórico de pagamentos
GET    /billing/subscription/invoice   → link para boleto/PIX atual (via Asaas)
```

### M3.4 — Plano Fundador

```js
// Validação de vagas de fundador
async function checkFounderSlots() {
  const plan = await db.plan.findFirst({ where: { isFounder: true } });
  if (!plan || plan.founderSlotsRemaining <= 0) {
    throw new Error('FOUNDER_SLOTS_EXHAUSTED');
  }
  return plan;
}

// Ativar plano fundador (requer código de convite)
async function activateFounderPlan(tenantId, inviteCode) {
  const invite = await db.founderInvite.findUnique({ where: { code: inviteCode } });
  if (!invite || invite.usedAt) throw new Error('INVALID_INVITE');
  
  await db.$transaction(async (tx) => {
    await tx.founderInvite.update({ where: { id: invite.id }, data: { usedAt: new Date(), tenantId } });
    await tx.plan.update({ where: { isFounder: true }, data: { founderSlotsRemaining: { decrement: 1 } } });
    // criar assinatura...
  });
}
```

### M3.5 — Segurança Específica de Billing

- **Nunca logar** API key da Asaas em logs de aplicação
- Validar que o `tenantId` na URL corresponde ao JWT antes de qualquer ação de billing
- Todas as operações financeiras registradas no `audit_log`
- Webhook processado em job assíncrono — nunca processar sincrono (evita timeout e retry infinito da Asaas)

**Entregável do Módulo 3:** Assinaturas funcionando (Pix/boleto/cartão), webhooks processando, créditos sendo carregados automaticamente, avulso funcionando.

---

## Módulo 4 — Motor de Análise (v2.2 → v3.0)

> **Fase:** 1 → 2  
> **Duração estimada:** 1 semana  
> **Dependências:** Módulo 2 (Credit Guard)

### M4.1 — Adaptações de Segurança e Privacidade

**Regra crítica:** o PDF nunca toca o disco. Processamento exclusivamente em memória.

```js
// src/controllers/analyzeController.js (v3.0)
export async function analyzeContract(req, res) {
  const { pdfBase64 } = req.body;
  const { userId, tenantId } = req.auth;

  // 1. Verificar crédito (middleware creditGuard já fez isso, mas verificar novamente)
  //    Esta dupla verificação evita race conditions em alta concorrência
  
  // 2. Criar registro de análise com status 'PROCESSING'
  const analysis = await db.analysis.create({
    data: { tenantId, userId, status: 'PROCESSING', filenameHash: hashFilename(pdfBase64) }
  });

  // 3. Debitar crédito de forma atômica (com analysisId para audit trail)
  await db.$transaction(async (tx) => {
    await creditService.debitCredit(tenantId, userId, analysis.id, tx);
  });

  // 4. Responder 202 Accepted imediatamente
  res.status(202).json({ analysisId: analysis.id, status: 'PROCESSING' });

  // 5. Enfileirar job de processamento (PDF em memória, nunca em disco)
  await analysisQueue.add('process-pdf', {
    analysisId: analysis.id,
    pdfBase64,   // buffer passado via job (Redis)
    tenantId,
    userId,
  }, {
    attempts: 1, // PDF analysis: sem retry automático (estorna crédito em falha)
    removeOnComplete: true,
    removeOnFail: true,
  });
}
```

**Nota de escalabilidade:** Para PDFs grandes (>5 MB), considerar passar o buffer via stream ao invés de base64 no job do Redis. Em alta escala (>1000 análises/dia), usar upload direto para storage temporário (bucket com TTL de 15 min) em vez de base64 no body.

### M4.2 — Worker de Análise

```js
// src/jobs/analysisWorker.js
analysisQueue.process('process-pdf', async (job) => {
  const { analysisId, pdfBase64, tenantId, userId } = job.data;
  
  // O buffer existe apenas na memória do worker durante o processamento
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');
  
  try {
    // === Toda a lógica da v2.2 mantida ===
    const [extraction, metadata] = await Promise.all([
      extractPdfTextWithOcr(pdfBuffer),
      extractPdfMetadata(pdfBuffer),
    ]);
    const fallback = heuristicExtractionFromText(extraction.text);
    // ... geocodificação, haversine, etc.
    
    const result = buildReport({ extraction, metadata, fallback, /* ... */ });
    
    // Salvar APENAS o resultado estruturado (nunca o buffer)
    await db.analysis.update({
      where: { id: analysisId },
      data: { status: 'COMPLETED', result },
    });
    
    // Buffer é garbage-collected aqui — sem referências restantes
    
  } catch (error) {
    // Estornar crédito automaticamente
    await creditService.refundCredit(tenantId, userId, analysisId);
    
    await db.analysis.update({
      where: { id: analysisId },
      data: { status: 'ERROR' },
    });
    
    // Notificar usuário do erro
    await notificationQueue.add('analysis-error', { tenantId, analysisId });
  }
});
```

### M4.3 — Polling de Status e Download de Laudo

```
GET  /api/analyses/:id/status  → { status, createdAt }
GET  /api/analyses/:id/result  → resultado completo (só se COMPLETED)
GET  /api/analyses/:id/pdf     → laudo em PDF gerado on-demand (sem cache)
GET  /api/analyses             → histórico paginado do tenant
```

**Segurança:** Verificar que `analysis.tenantId === req.auth.tenantId` antes de retornar qualquer dado.

### M4.4 — Limites Anti-Abuso

```js
// Limite de tamanho do PDF no middleware (antes de qualquer processamento)
app.use('/api/analyze', express.json({ limit: '30mb' }));

// Limite de análises simultâneas por tenant (1 análise por vez)
const analysisLock = new Map(); // tenantId → boolean
// Em produção com múltiplas instâncias: usar Redis SETNX como mutex distribuído
```

**Entregável do Módulo 4:** Motor de análise v2.2 funcionando no contexto SaaS — com auth, credit guard, processamento assíncrono e histórico de laudos.

---

## Módulo 5 — Frontend

> **Fase:** 0 → 2 (em paralelo com módulos backend)  
> **Duração estimada:** 2 semanas  
> **Dependências:** Módulos 1, 2, 4 (APIs prontas)

### M5.1 — Estrutura de Rotas e Estado Global

```
src/
  pages/
    Landing.jsx          → página pública
    Register.jsx         → cadastro
    Login.jsx            → login
    VerifyEmail.jsx      → confirmação de e-mail
    Onboarding.jsx       → wizard 3 steps
    Dashboard.jsx        → dashboard principal
    Analyze.jsx          → upload + análise
    Report.jsx           → visualização do laudo
    History.jsx          → histórico de análises
    Plans.jsx            → tabela de planos + checkout
    Account.jsx          → dados da conta
    Team.jsx             → gerenciar membros (owner only)
    NotFound.jsx
  
  components/
    Layout/
      AppLayout.jsx      → header, sidebar, credit widget
      PublicLayout.jsx   → layout da landing page
    CreditWidget.jsx     → saldo sempre visível
    CreditModal.jsx      → modal de crédito zerado
    AnalysisResult.jsx   → componente do laudo (v2.2 adaptado)
    NotificationBell.jsx
    PlanCard.jsx
    UpgradePrompt.jsx
  
  store/
    authStore.js         → Zustand: user, token, refresh
    creditStore.js       → Zustand: saldo, polling
    notificationStore.js
  
  hooks/
    useAuth.js
    useCredits.js
    useAnalysis.js       → polling do job assíncrono
  
  api/
    client.js            → axios/fetch com interceptors (auto-refresh token)
    auth.js
    credits.js
    billing.js
    analyses.js
```

### M5.2 — Segurança no Frontend

- **Access token**: armazenado em memória JavaScript (Zustand store) — **nunca em localStorage**
- **Refresh token**: armazenado em cookie `HttpOnly, Secure, SameSite=Strict` (inacessível ao JS)
- **Auto-refresh**: interceptor no cliente HTTP detecta 401 e refaz a requisição após refresh
- **Logout automático**: ao fechar a aba, access token some da memória; refresh token válido no cookie para próximo acesso
- **CSP**: Content-Security-Policy bloqueia scripts inline e origens não autorizadas

```js
// api/client.js — auto-refresh interceptor
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      await authStore.getState().refreshTokens(); // POST /auth/refresh
      return api(error.config); // retry com novo token
    }
    return Promise.reject(error);
  }
);
```

### M5.3 — Polling do Job de Análise

```js
// hooks/useAnalysis.js
export function useAnalysisStatus(analysisId) {
  const [status, setStatus] = useState('PROCESSING');
  const [result, setResult] = useState(null);
  
  useEffect(() => {
    if (!analysisId || status === 'COMPLETED' || status === 'ERROR') return;
    
    const interval = setInterval(async () => {
      const data = await api.get(`/api/analyses/${analysisId}/status`);
      setStatus(data.status);
      if (data.status === 'COMPLETED') {
        const full = await api.get(`/api/analyses/${analysisId}/result`);
        setResult(full);
        clearInterval(interval);
      }
    }, 2000); // polling a cada 2 segundos
    
    return () => clearInterval(interval);
  }, [analysisId, status]);
  
  return { status, result };
}
```

### M5.4 — Landing Page

- Hero section com CTA "Começar grátis com 3 laudos"
- Tabela de planos com toggle mensal/anual
- Seção de comparação ForenseDoc × Perícia de TI
- Seção de depoimentos (placeholder até fundadores)
- FAQ
- Footer com links legais (Termos de Uso, Política de Privacidade)
- SEO: meta tags, OG tags, estrutura semântica (`h1` único, schema.org)

**Entregável do Módulo 5:** SPA completa — landing, auth, onboarding, dashboard com credit widget, upload e análise, histórico, checkout de planos.

---

## Módulo 6 — Admin Panel

> **Fase:** 2 → 3  
> **Duração estimada:** 1 semana  
> **Dependências:** Módulos 1-5

### M6.1 — Rotas Admin (Backend)

```
GET  /admin/dashboard          → MRR, ARR, churn, totais
GET  /admin/tenants            → lista com filtros e paginação
GET  /admin/tenants/:id        → detalhes do tenant
POST /admin/tenants/:id/credits  → adicionar créditos manuais
POST /admin/tenants/:id/suspend  → suspender conta
POST /admin/tenants/:id/activate → reativar conta
GET  /admin/plans              → lista planos
PATCH /admin/plans/:id         → editar plano (preço, créditos, vagas)
POST /admin/founder-invites    → gerar código de convite fundador
GET  /admin/referrals          → programa de indicação
GET  /admin/analyses           → laudos gerados (stats, sem conteúdo)
GET  /admin/payments           → todos os pagamentos
GET  /admin/audit-logs         → audit trail completo
```

**Segurança:** 
- Prefixo `/admin` com middleware `requirePlatformAdmin` (campo `isPlatformAdmin` no JWT, setado apenas para o e-mail do operador configurado em `.env`)
- Rate limit extra rigoroso: 30 req/min para rotas admin
- Todas as ações admin registradas no `audit_log` com `userId` do operador

### M6.2 — Métricas do Dashboard Admin

```js
async function getDashboardMetrics() {
  const [mrr, tenantsByPlan, churn, laudoStats, recentSignups] = await Promise.all([
    calculateMRR(),
    countTenantsByPlan(),
    calculateMonthlyChurn(),
    getAnalysisStats(),
    getRecentSignups(30),
  ]);
  
  return {
    mrr,
    arr: mrr * 12,
    tenantsByPlan,
    churn,
    laudoStats,
    recentSignups,
    breakEvenStatus: mrr >= 2500 ? 'ACHIEVED' : 'PENDING',
  };
}
```

### M6.3 — Frontend Admin (Protegido)

- Rota `/admin` protegida: renderizada apenas para usuário com `isPlatformAdmin: true` no token
- Componentes: tabela de tenants, gráficos de MRR/ARR (biblioteca `recharts`), formulário de crédito manual

**Entregável do Módulo 6:** Admin panel funcional com dashboard de métricas, gestão de tenants e planos.

---

## Módulo 7 — Notificações

> **Fase:** 2  
> **Duração estimada:** 0,5 semana  
> **Dependências:** Módulos 1-4 (produzem eventos)

### M7.1 — Sistema de Notificações In-App

```prisma
model Notification {
  id        String   @id @default(uuid())
  tenantId  String
  userId    String?  // null = notificação para todos do tenant
  type      NotificationType
  title     String
  body      String
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

```
GET  /notifications          → lista (não lidas primeiro)
POST /notifications/read-all → marcar todas como lidas
PATCH /notifications/:id/read
```

### M7.2 — Fila de E-mails

```js
// src/jobs/emailWorker.js — templates para cada tipo de notificação
const EMAIL_TEMPLATES = {
  CREDITS_80PCT: {
    subject: '⚠️ Você já usou 80% dos seus laudos este mês',
    template: 'credits-alert',
  },
  CREDITS_95PCT: {
    subject: '🔴 Atenção: restam poucos laudos disponíveis',
    template: 'credits-critical',
  },
  CREDITS_EXHAUSTED: {
    subject: '🚫 Seus créditos acabaram — recarregue agora',
    template: 'credits-zero',
  },
  PAYMENT_FAILED: {
    subject: '❗ Pagamento não aprovado — 2 créditos de emergência concedidos',
    template: 'payment-failed',
  },
  PAYMENT_CONFIRMED: {
    subject: '✅ Pagamento confirmado — créditos renovados',
    template: 'payment-confirmed',
  },
  RENEWAL_REMINDER: {
    subject: '📅 Sua assinatura renova em 3 dias',
    template: 'renewal-reminder',
  },
  ACCOUNT_SUSPENDED: {
    subject: '⛔ Sua conta foi suspensa',
    template: 'account-suspended',
  },
  EMAIL_VERIFICATION: {
    subject: '✉️ Confirme seu e-mail — ForenseDoc',
    template: 'verify-email',
  },
};
```

### M7.3 — Cron Jobs de Notificação

```js
// Disparados diariamente pelo BullMQ Scheduler:
// 1. Verificar assinaturas que renovam em 3 dias → e-mail RENEWAL_REMINDER
// 2. Verificar contas com pagamento overdue há 3 dias → e-mail de urgência
// 3. Verificar contas overdue há 7 dias → suspender + e-mail ACCOUNT_SUSPENDED
```

**Entregável do Módulo 7:** Notificações in-app funcionando, e-mails transacionais para todos os eventos críticos.

---

## Fase Final — Hardening & Launch

> **Duração estimada:** 1 semana  
> **Objetivo:** Validar segurança, performance e resiliência antes do lançamento público

### FL.1 — Checklist de Segurança Pré-Launch

**Infraestrutura:**
- [ ] Firewall UFW com apenas portas 22, 80, 443 abertas
- [ ] SSH com chave (login por senha desabilitado)
- [ ] Fail2ban ativo para SSH e Nginx
- [ ] Certbot com renovação automática testada
- [ ] Todos os secrets em variáveis de ambiente (não no git)
- [ ] `.env` com permissão `600` (owner-only)

**Aplicação:**
- [ ] Todos os endpoints protegidos por `requireAuth` (testar sem token)
- [ ] Tenant isolation testado (tentar acessar dados de outro tenant → 403)
- [ ] Rate limiting funcionando (testar brute force em login → 429)
- [ ] Cabeçalhos de segurança presentes (verificar com securityheaders.com)
- [ ] PDF nunca salvo em disco (verificar com `strace` ou auditoria de I/O)
- [ ] Webhook Asaas rejeitando token inválido → 401

**Dados:**
- [ ] Backup automático testado (dump + restore em ambiente de teste)
- [ ] Backup verificado fora da VPS (copiar para armazenamento externo)
- [ ] Índices de banco criados e verificados com `EXPLAIN ANALYZE`

### FL.2 — Checklist de Performance

- [ ] Tempo de resposta do `POST /auth/login` < 500ms (inclui bcrypt)
- [ ] Tempo de resposta do `GET /credits/balance` < 100ms (com cache Redis)
- [ ] Job de análise PDF completo em < 30s (para PDFs típicos de 1-5 páginas)
- [ ] Frontend Vite build servido pelo Nginx com gzip (< 200KB transferido)
- [ ] Teste de carga: 10 usuários simultâneos gerando análises sem erros

### FL.3 — Checklist de Resiliência

- [ ] Reinicialização do backend não perde jobs pendentes (BullMQ no Redis)
- [ ] Falha na Asaas (API down) não quebra a aplicação — erros tratados
- [ ] Falha de crédito no meio de análise → estorno automático funcionando
- [ ] Webhook processado com idempotência
- [ ] Restart dos containers no Railway funciona sem downtime

### FL.4 — Monitoramento Básico

```bash
# Railway logs
railway logs

# Healthcheck endpoint
GET /health → { status: 'ok', db: 'ok', redis: 'ok', version: '3.0.0' }
```

### FL.5 — Smoke Tests Pós-Deploy

Script de verificação automática a rodar após cada deploy:

```bash
# scripts/smoke-test.sh
BASE_URL=https://forensedoc.com.br/api

echo "1. Health check..."
curl -sf $BASE_URL/health | jq .status

echo "2. Registro de teste..."
REGISTER=$(curl -sf -X POST $BASE_URL/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.com","password":"Test123!","name":"Smoke","oabNumber":"12345","oabState":"PI","cpfCnpj":"000.000.000-00"}')
echo $REGISTER | jq .

echo "3. Login de teste..."
LOGIN=$(curl -sf -X POST $BASE_URL/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.com","password":"Test123!"}')
TOKEN=$(echo $LOGIN | jq -r .accessToken)

echo "4. Saldo de créditos (trial: 3)..."
curl -sf $BASE_URL/credits/balance \
  -H "Authorization: Bearer $TOKEN" | jq .

echo "✅ Smoke tests concluídos"
```

---

## 13. Ordem de Execução Resumida

```
DIA 1 (horas)
└── Fase 0: Railway (PostgreSQL + Redis + backend deploy + Vercel frontend)
     → Sistema acessível via domínio em ~3 horas

SEMANA 1
├── Módulo 1 (início): Schema Prisma + Register + Login + JWT
└── Módulo 1 (conclusão): Refresh token, verify email, invite membros

SEMANA 2
├── Módulo 2: Credit Engine completo (debit, refund, alerts, cron)
├── Módulo 5 (início): Auth pages (login, register, verify) + roteamento
└── Módulo 3: Billing Asaas (assinatura, avulso, webhooks)

SEMANA 3
├── Módulo 4: Motor de análise adaptado (async, credit guard, histórico)
├── Módulo 5 (continuação): Dashboard, credit widget, analyze page
└── Módulo 5 (conclusão): Landing page, plans/checkout, history

SEMANA 4
├── Módulo 7: Notificações in-app + e-mails transacionais
├── Fase Final: Hardening, testes de segurança, smoke tests
└── 🚀 Launch Fundadores — abertura das 25 vagas (Railway)

SEMANA 5–6 (pós-fundadores)
├── Módulo 6: Admin panel (dashboard métricas + gestão tenants)
├── Migração Railway → VPS (ver seção 13)
└── 🚀 Abertura Pública (Fase 2 do PRD) — rodando em VPS dedicada
```

### Dependências Críticas do Caminho

```
Fase 0 (Railway) → M1 → M2 → M3 → M4 → M5 → 🚀 Launch Fundadores
                                    ↗                      ↓
                              M5 (paralelo)          Migração VPS
                                                           ↓
                                                   🚀 Abertura Pública
                                              M6 + M7 (podem vir depois)
```

---

## Apêndice: Variáveis de Ambiente

```env
# Servidor
NODE_ENV=production
PORT=8787

# Banco de dados
DATABASE_URL=postgresql://forensedoc_app:SENHA@postgres:5432/forensedoc_prod

# Redis
REDIS_URL=redis://:REDIS_PASSWORD@redis:6379
REDIS_PASSWORD=

# Auth (gerar com: openssl rand -base64 32)
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

# Asaas
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=
ASAAS_ENV=production  # ou sandbox

# E-mail
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=noreply@forensedoc.com.br

# Admin
PLATFORM_ADMIN_EMAIL=

# App
FRONTEND_URL=https://forensedoc.com.br
CORS_ORIGIN=https://forensedoc.com.br
```

---

*Plano gerado com base no PRD v3.0. Atualizar conforme cada módulo for concluído.*
