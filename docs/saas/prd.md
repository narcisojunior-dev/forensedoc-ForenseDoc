# ForenseDoc — PRD v3.0: SaaS B2B com Sistema de Créditos (Laudos)

> **Status:** Aprovado — decisões de produto definidas  
> **Versão do produto:** 3.0  
> **Data:** Julho de 2026  
> **Autor:** Narciso Junior (Ronney Menezes Advocacia)  
> **Base:** ForenseDoc v2.2 (local) → SaaS B2B multi-tenant com créditos

---

## 1. Visão Geral e Contexto

O ForenseDoc é uma ferramenta de análise forense de contratos de consignado que gera laudos técnicos periciais com hash criptográfico, geolocalização de IP, distância geográfica e cadeia de custódia. Na versão atual (v2.2), opera localmente para uso pessoal do advogado titular.

A v3.0 transforma o ForenseDoc em uma plataforma **SaaS B2B multi-tenant**, vendida pelo advogado titular (operador/admin) para outros advogados (clientes), com base em um **modelo de créditos**, onde cada laudo gerado consome 1 crédito.

### Proposta de Valor

| Para | O que resolve |
|------|--------------|
| Advogado autônomo | Substitui perícia de TI (R$ 1.500–5.000/peça) por laudo em minutos |
| Escritórios de massa | Escala a produção de provas técnicas sem contratar peritos |
| Operador (você) | Receita recorrente com margem de 83–85% por faixa |

---

## 2. Decisões de Produto (Definidas)

| # | Tema | Decisão |
|---|------|---------|
| P1 | Gateway de pagamento | **Asaas** (Pix, boleto, cartão nacional) |
| P2 | Banco de dados / Infra | **VPS própria** com PostgreSQL |
| P3 | Avulso | **1 crédito por R$ 79** — sem pacotes |
| P4 | Sublimites por usuário | **Não** — créditos são do pool da equipe (tenant) |
| P5 | Validade de créditos avulsos | **Sem validade** — créditos só se consomem quando usados |
| P6 | Retenção de dados / LGPD | **Apenas o laudo/resultado** é salvo. PDF nunca armazenado |
| P7 | Período de graça | **2 créditos de emergência** (não em dias) em caso de falha de pagamento |

---

## 3. Modelo de Negócio — Créditos (Laudos)

### 3.1 Mecânica de Créditos

- **1 crédito = 1 análise/laudo** gerado na plataforma
- Créditos são **adquiridos em pacotes** (planos mensais ou avulso)
- A franquia mensal **não acumula** entre ciclos — créditos de assinatura não utilizados expiram na renovação
- Créditos avulsos **não têm validade** — persistem até serem consumidos
- Ao zerar os créditos, o sistema **bloqueia nova análise** e exibe tela de recarga
- O acesso à plataforma (login, histórico, laudos já gerados) permanece ativo mesmo com crédito zerado

### 3.2 Tabela de Planos

| Plano | Preço | Créditos/mês | Usuários | Posicionamento |
|-------|-------|--------------|----------|----------------|
| **Avulso** | R$ 79,00/laudo | Sem assinatura | 1 | Porta de entrada, sem compromisso |
| **Inicial** | R$ 197,00/mês | 15 laudos | 1 | Oferta de entrada |
| **Profissional** | R$ 297,00/mês | 40 laudos | 1 | **Plano-âncora** |
| **Escritório** | R$ 597,00/mês | 120 laudos | 3 | Operação em equipe |
| **Massa / Operação** | R$ 1.990,00/mês | 500 laudos | 5 | Litígio de massa |
| **Excedente** | R$ 7,90/laudo | Acima do teto | — | Upgrade sem bloqueio |
| **Fundador** *(lançamento)* | R$ 197,00/mês | 40 laudos | 1 | Primeiros 25 assinantes, 12 meses travado |
| **Anual** | 10× a mensalidade | Conforme plano | Conforme plano | 2 meses grátis |

> **Regra de excedente:** ao atingir 100% da franquia, o usuário é notificado e pode continuar gerando laudos a R$ 7,90/laudo (cobrado no cartão cadastrado ao final do ciclo) ou fazer upgrade de plano.

### 3.3 Trial Gratuito

- Novos usuários ganham **3 créditos gratuitos** ao criar conta (sem cartão)
- Após consumir o trial, é obrigatório escolher um plano para continuar
- Trial é por conta (CPF/CNPJ), não por e-mail

### 3.4 Créditos de Emergência (Falha de Pagamento)

Em caso de falha na cobrança da assinatura:
- O sistema concede automaticamente **2 créditos de emergência**
- Esses créditos permitem que o usuário continue operando enquanto regulariza o pagamento
- Notificação imediata por e-mail e in-app com instruções para atualizar o cartão/gerar novo boleto
- Se o pagamento não for regularizado em até **7 dias**, a conta é suspensa (acesso ao histórico mantido)
- Os 2 créditos de emergência **não são cobrados** — são um buffer de boa vontade

---

## 4. Personas

### Persona A — Advogado Autônomo (target principal)
- Atua em direito bancário/consignado
- Tem 10–100 casos ativos por mês
- Não tem equipe de TI
- Dor: precisa de prova técnica sem contratar perito
- Plano esperado: **Profissional (R$ 297)**

### Persona B — Escritório de Médio Porte
- 2–5 advogados, 100–300 casos/mês
- Créditos compartilhados no pool da equipe (sem sublimites por membro)
- Plano esperado: **Escritório (R$ 597)**

### Persona C — Escritório de Massa
- 5+ advogados, 300–1.000+ casos/mês
- Produção industrial de laudos, pool de créditos compartilhado
- Plano esperado: **Massa (R$ 1.990)**

### Persona D — Operador/Admin (você)
- Controla toda a plataforma
- Visualiza MRR, churn, uso por cliente
- Pode conceder créditos manuais, suspender contas, gerenciar planos

---

## 5. Arquitetura do Sistema (v3.0)

### 5.1 Visão Geral

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React/Vite)                  │
│  Landing Page · Auth · Dashboard · Análise · Pagamentos  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS / API REST
┌──────────────────────▼──────────────────────────────────┐
│                   BACKEND (Node/Express)                  │
│  Auth Middleware · Credits Guard · Analyze · Admin API   │
└────┬───────────────┬───────────────┬────────────────────┘
     │               │               │
┌────▼────┐   ┌──────▼──────┐  ┌────▼──────────┐
│PostgreSQL│   │  PDF Engine  │  │     Asaas      │
│ (VPS)   │   │ (OCR + Parse)│  │(Pix/Boleto/CC) │
└─────────┘   └─────────────┘  └───────────────┘
```

### 5.2 Módulos Novos (em relação à v2.2)

| Módulo | Responsabilidade |
|--------|-----------------|
| **Auth** | Cadastro, login, JWT, recuperação de senha |
| **Multi-tenant** | Isolamento de dados por `tenant_id` |
| **Credits Engine** | Saldo, consumo, recarga, créditos de emergência |
| **Billing / Asaas** | Integração com Asaas, webhooks de pagamento |
| **Admin Panel** | Dashboard do operador: MRR, usuários, uso |
| **Notifications** | Alertas de saldo baixo, falha de pagamento |
| **Audit Log** | Registro de cada análise com crédito consumido |

---

## 6. Funcionalidades por Módulo

### 6.1 Autenticação e Onboarding

#### RF-01: Cadastro de Conta
- Formulário: nome, e-mail, senha, OAB (número + estado), CPF/CNPJ, telefone
- Validação de e-mail por link
- OAB é campo obrigatório (diferencial de confiança e compliance)
- Ao confirmar e-mail → conta criada com **3 créditos de trial**

#### RF-02: Login
- E-mail + senha
- "Lembrar-me" (refresh token 30 dias)
- Recuperação de senha via e-mail

#### RF-03: Onboarding
- Wizard de boas-vindas (3 steps): perfil → plano → primeiro laudo
- Destaque dos 3 créditos trial disponíveis
- CTA claro: "Fazer meu primeiro laudo agora"

---

### 6.2 Dashboard do Usuário

#### RF-04: Visão Geral de Créditos
- **Widget de créditos** sempre visível no topo: `X créditos restantes | Renovam em DD/MM/AAAA`
- Barra de progresso visual do consumo
- Indicação visual de créditos avulsos disponíveis (separados dos mensais)
- Botão "Comprar mais créditos" — ativo sempre

#### RF-05: Histórico de Análises
- Lista paginada de todos os laudos gerados pela conta (todos os membros do tenant)
- Colunas: data, usuário que gerou, nome do arquivo (hash), crédito consumido, status
- Download do laudo PDF de análises anteriores
- Filtros: por data, por usuário, por status

#### RF-06: Indicadores de Uso
- Total de laudos gerados (histórico acumulado do tenant)
- Laudos no ciclo atual
- Média de laudos/mês (últimos 3 meses)

---

### 6.3 Motor de Análise (herdado da v2.2, adaptado)

#### RF-07: Upload e Análise de Contrato
- Mantém toda a lógica existente de análise forense (hashes, OCR, geolocalização, mapa)
- **Novo:** antes de executar, o sistema verifica se o tenant tem ≥ 1 crédito disponível
- Se não tiver crédito → exibe modal de recarga, bloqueia análise
- Se tiver → consome 1 crédito atomicamente ao **iniciar** a análise
- Em caso de erro no processamento → crédito é **estornado automaticamente**
- **O PDF nunca é armazenado no servidor** — processado em memória e descartado imediatamente
- O laudo/resultado gerado é salvo no banco de dados vinculado ao `tenant_id` e `user_id`
- Registro no audit log: `user_id`, `tenant_id`, `timestamp`, `filename_hash`, `credit_used: 1`, `status`

#### RF-08: Pool de Créditos da Equipe (Planos Escritório e Massa)
- Créditos são **compartilhados no pool do tenant** entre todos os usuários membros
- Não há sublimites individuais por usuário
- O admin do tenant pode ver **quem consumiu cada crédito** no histórico de análises
- Qualquer membro pode gerar laudos até o pool zerar

---

### 6.4 Sistema de Créditos

#### RF-09: Créditos por Plano (Recorrente)
- Ao assinar um plano, o saldo de créditos mensais é carregado no início do ciclo
- Ciclo mensal: renovação automática na mesma data da assinatura
- **Créditos mensais não utilizados expiram** na renovação — não há rollover
- Notificação 3 dias antes da renovação (e-mail + in-app)

#### RF-10: Crédito Avulso (R$ 79)
- Compra de 1 crédito por R$ 79,00 — sem assinatura, sem compromisso
- **Sem validade** — o crédito avulso só é consumido quando o usuário gerar um laudo
- Disponível para usuários sem plano ativo e para usuários de qualquer plano
- Forma de pagamento: Pix, boleto ou cartão (via Asaas)

#### RF-11: Créditos de Emergência (Falha de Pagamento)
- Em caso de falha na cobrança da assinatura, o sistema concede **2 créditos de emergência**
- Créditos de emergência são gratuitos — servem como buffer enquanto o pagamento é regularizado
- Prazo para regularizar: **7 dias** após a falha
- Se não regularizado em 7 dias: conta suspensa (histórico e laudos salvos permanecem acessíveis)
- Créditos de emergência ficam marcados no audit log como `type: emergency`

#### RF-12: Excedente (Assinantes)
- Ao atingir 80% da franquia: alerta amarelo (in-app + e-mail)
- Ao atingir 95% da franquia: alerta vermelho (in-app + e-mail)
- Ao atingir 100%: modal de aviso com três opções:
  1. Fazer upgrade de plano agora
  2. Continuar com excedente a R$ 7,90/laudo (cobrado no ciclo)
  3. Aguardar renovação do ciclo
- Excedentes são cobrados no fechamento do ciclo

#### RF-13: Recarga Manual de Créditos (Admin)
- Operador pode adicionar créditos manualmente a qualquer conta
- Uso: gratuidades, correções, bonificações
- Registro obrigatório do motivo no audit log

---

### 6.5 Pagamentos e Assinatura (Asaas)

#### RF-14: Integração Asaas
- Cobranças via Pix, boleto bancário e cartão de crédito nacional
- Assinaturas mensais e anuais com cobrança recorrente gerenciada pelo Asaas
- Webhooks processados pelo backend:
  - `PAYMENT_RECEIVED` → ativar/renovar créditos do tenant
  - `PAYMENT_OVERDUE` → conceder 2 créditos de emergência + notificar
  - `SUBSCRIPTION_CANCELLED` → manter acesso até fim do ciclo pago

#### RF-15: Gerenciamento de Assinatura (Self-service)
- Usuário pode fazer upgrade, downgrade ou cancelar pelo painel
- **Upgrade:** créditos adicionais creditados imediatamente (diferença pro-rata)
- **Downgrade:** entra em vigor no próximo ciclo
- **Cancelamento:** acesso e créditos restantes mantidos até o fim do ciclo atual

#### RF-16: Plano Fundador
- Disponível apenas para os primeiros **25 usuários** (vagas controladas pelo admin)
- R$ 197/mês com 40 laudos por **12 meses travado** (sem reajuste)
- Após 12 meses: migração automática para o Plano Profissional (R$ 297)
- Ativação por convite (código único enviado pelo operador)

#### RF-17: Plano Anual
- Desconto equivalente a **2 meses grátis** (cobrado 10× o valor mensal à vista)
- Créditos carregados mensalmente conforme o plano contratado
- Cancelamento: sem reembolso proporcional; acesso mantido até o fim do período

---

### 6.6 Painel Administrativo (Operador)

#### RF-18: Dashboard do Operador
- MRR (Receita Mensal Recorrente)
- ARR (Receita Anual Recorrente)
- Total de assinantes ativos, por plano
- Churn mensal (% e absoluto)
- Laudos gerados na plataforma (total e por período)
- Novos cadastros nos últimos 30 dias
- Gráficos de evolução mês a mês

#### RF-19: Gestão de Usuários/Tenants
- Lista de todos os tenants com: plano, status, créditos restantes, laudos no ciclo, último acesso
- Ações por tenant: adicionar créditos manuais, suspender, alterar plano, ver histórico completo
- Filtros: por plano, por status, por data de cadastro

#### RF-20: Gestão de Planos
- Interface para ajustar preços e franquias de cada plano
- Ativar/desativar planos (ex: encerrar o Fundador após 25 vagas)
- Controle de vagas disponíveis para o Plano Fundador

#### RF-21: Programa de Indicação
- Cada assinante tem um link/código de indicação único
- Ao converter uma indicação em assinante pago: indicador ganha **1 mês grátis** (créditos equivalentes ao plano atual)
- Admin acompanha indicações pendentes e convertidas

---

### 6.7 Notificações

#### RF-22: Alertas de Crédito e Pagamento

| Gatilho | Canal | Mensagem |
|---------|-------|----------|
| 80% dos créditos consumidos | In-app + e-mail | "Você usou 80% dos seus laudos este mês" |
| 95% dos créditos consumidos | In-app + e-mail | "Atenção: restam apenas X laudos" |
| 100% — crédito zerado | In-app + e-mail | "Seus créditos acabaram — recarregue para continuar" |
| 3 dias antes da renovação | E-mail | "Sua assinatura renova em 3 dias" |
| Falha no pagamento | E-mail urgente + in-app | "Pagamento não aprovado — 2 créditos de emergência concedidos" |
| 3 dias após falha (sem regularizar) | E-mail | "Regularize o pagamento em até 4 dias para evitar suspensão" |
| Conta suspensa | E-mail | "Sua conta foi suspensa — histórico disponível para consulta" |

#### RF-23: Notificações In-App
- Ícone de sino no header com badge de não lidas
- Centro de notificações com histórico dos últimos 30 dias

---

### 6.8 Landing Page

#### RF-24: Landing Page Pública
- Hero com proposta de valor e CTA "Começar grátis com 3 laudos"
- Tabela de planos com CTAs por faixa
- Seção âncora: "ForenseDoc vs. Perícia de TI" (R$ 79 × R$ 1.500–5.000)
- Seção de depoimentos (preenchida após lançamento dos fundadores)
- FAQ
- Rodapé com Termos de Uso e Política de Privacidade

---

## 7. Regras de Negócio Críticas

### RN-01: Atomicidade do Débito de Crédito
O crédito é **reservado antes** de iniciar o processamento do PDF. Em caso de erro no processamento, o crédito é **estornado automaticamente**. Nunca há cobrança de crédito por análise que não foi concluída.

**Ordem de consumo de créditos:**
1. Créditos mensais da assinatura (expiram no ciclo)
2. Créditos de emergência (se ativos)
3. Créditos avulsos (sem validade)

### RN-02: Isolamento Multi-Tenant
Dados de laudos de um tenant **nunca podem ser acessados** por outro tenant. Toda query ao banco inclui `WHERE tenant_id = $1`. Não há créditos compartilhados entre tenants diferentes.

### RN-03: Imutabilidade do Laudo
Um laudo gerado não pode ser alterado retroativamente. Re-análise do mesmo arquivo gera um novo laudo e consome 1 crédito adicional.

### RN-04: Expiração Seletiva de Créditos
- Créditos mensais (plano): expiram na renovação do ciclo
- Créditos avulsos (R$ 79): **sem validade**, persistem indefinidamente
- Créditos de emergência: expiram automaticamente quando o pagamento é regularizado
- Créditos manuais do admin: sem validade (definido no ato de concessão)

### RN-05: Créditos de Emergência (2 créditos)
Concedidos automaticamente em caso de falha de pagamento. Não são cobrados. O sistema verifica se o tenant já recebeu créditos de emergência para o ciclo atual (máx. 1 vez por ciclo).

### RN-06: Privacidade e LGPD
- O PDF enviado pelo usuário é processado **exclusivamente em memória**
- Após o processamento, o buffer é descartado — nenhum dado do arquivo original é persistido
- Apenas o **resultado estruturado** (laudo) é armazenado: dados extraídos, hashes criptográficos, métricas geográficas
- O laudo não contém o binário do PDF, apenas os metadados e análises derivadas

### RN-07: OAB no Cadastro
O número da OAB é coletado mas **não validado automaticamente** na v3.0. Validação manual pelo operador quando necessário.

---

## 8. Fluxos de Usuário Principais

### Fluxo 1: Primeiro Acesso (Trial)
```
Landing Page
  └── Cadastro (nome, e-mail, OAB, senha)
       └── Confirmar e-mail
            └── Onboarding wizard (perfil → plano → 1º laudo)
                 └── Dashboard [saldo: 3 créditos trial]
                      └── Upload PDF → Análise → Laudo gerado
                           └── Dashboard [saldo: 2 créditos]
```

### Fluxo 2: Crédito Zerado
```
Upload PDF
  └── Verificação de crédito: saldo = 0
       └── Modal "Seus créditos acabaram"
            ├── [Assinar plano] → Asaas → Pix/Boleto/Cartão → Créditos carregados → Análise
            └── [Comprar avulso R$ 79] → Asaas → Pix/Boleto/Cartão → +1 crédito → Análise
```

### Fluxo 3: Assinante com Excedente
```
Saldo atinge 100%
  └── Modal de aviso
       ├── [Upgrade] → Novo plano com mais créditos → Análise
       ├── [Excedente R$ 7,90/laudo] → Análise liberada (cobrado no fechamento do ciclo)
       └── [Aguardar renovação] → Bloqueio até a data de renovação
```

### Fluxo 4: Falha de Pagamento
```
Cobrança da assinatura falha
  └── Sistema concede 2 créditos de emergência
       └── Notificação: e-mail urgente + in-app
            └── Usuário regulariza em até 7 dias
                 ├── [Pagamento regularizado] → Créditos mensais renovados → Emergências expiram
                 └── [Não regularizado em 7 dias] → Conta suspensa → Histórico mantido
```

### Fluxo 5: Assinante Plano Escritório/Massa (Equipe)
```
Admin cria conta → Convida membros (até 3 ou 5 conforme plano)
  └── Membros acessam com login próprio
       └── Pool de créditos compartilhado (ex: 120 créditos para 3 usuários)
            └── Qualquer membro gera laudos → débita do pool
                 └── Admin visualiza histórico: quem gerou cada laudo
```

---

## 9. Modelo de Dados

```sql
-- Tenants (conta principal de cada cliente)
tenants (
  id UUID PRIMARY KEY,
  name TEXT,
  cpf_cnpj TEXT UNIQUE,
  oab_number TEXT,
  oab_state CHAR(2),
  status TEXT CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Users (membros de cada tenant)
users (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  email TEXT UNIQUE,
  name TEXT,
  password_hash TEXT,
  role TEXT CHECK (role IN ('owner', 'member')),
  oab_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Plans (configuração de planos)
plans (
  id UUID PRIMARY KEY,
  name TEXT,
  price_brl NUMERIC(10,2),
  credits_monthly INT,
  max_users INT,
  is_active BOOLEAN DEFAULT TRUE,
  is_founder BOOLEAN DEFAULT FALSE,
  founder_slots_remaining INT
)

-- Subscriptions (assinaturas ativas)
subscriptions (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  plan_id UUID REFERENCES plans(id),
  status TEXT CHECK (status IN ('active', 'overdue', 'cancelled')),
  current_period_start DATE,
  current_period_end DATE,
  asaas_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Credit Balances (saldo atual do tenant)
credit_balances (
  id UUID PRIMARY KEY,
  tenant_id UUID UNIQUE REFERENCES tenants(id),
  credits_monthly INT DEFAULT 0,        -- créditos do plano (expiram no ciclo)
  credits_avulso INT DEFAULT 0,         -- créditos avulsos (sem validade)
  credits_emergency INT DEFAULT 0,      -- créditos de emergência (temporários)
  credits_manual INT DEFAULT 0,         -- créditos concedidos pelo admin
  cycle_start DATE,
  cycle_end DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

-- Credit Transactions (ledger de movimentações)
credit_transactions (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  type TEXT CHECK (type IN ('earn_monthly','earn_avulso','earn_emergency','earn_manual','spend','expire','refund')),
  amount INT,  -- positivo = entrada, negativo = saída
  source TEXT, -- 'subscription_renewal', 'avulso_purchase', 'payment_failure', 'admin', etc.
  analysis_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Analyses (laudos gerados — sem o PDF, apenas resultado)
analyses (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  filename_hash TEXT,             -- hash do nome do arquivo (sem conteúdo)
  status TEXT CHECK (status IN ('completed', 'error', 'refunded')),
  result JSONB,                   -- laudo estruturado (sem dados binários do PDF)
  credit_transaction_id UUID REFERENCES credit_transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Payments (registro de cobranças)
payments (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  amount_brl NUMERIC(10,2),
  type TEXT CHECK (type IN ('subscription', 'avulso', 'excess')),
  status TEXT CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  asaas_payment_id TEXT,
  asaas_billing_type TEXT,        -- PIX, BOLETO, CREDIT_CARD
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

---

## 10. Critérios de Aceite por Épico

### Épico 1: Auth & Onboarding
- [ ] Usuário consegue criar conta com e-mail, senha e OAB
- [ ] Confirmação de e-mail funciona e bloqueia acesso sem confirmação
- [ ] Login e logout funcionam com JWT + refresh token
- [ ] Trial de 3 créditos creditado automaticamente na confirmação de e-mail
- [ ] Wizard de onboarding (3 steps) funciona e leva ao primeiro laudo

### Épico 2: Sistema de Créditos
- [ ] Saldo total exibido no dashboard (mensal + avulso separados)
- [ ] Cada análise debita exatamente 1 crédito
- [ ] Ordem de consumo respeitada: mensal → emergência → avulso
- [ ] Erro no processamento estorna o crédito automaticamente
- [ ] Bloqueio de análise com saldo total = 0
- [ ] Alertas de 80%, 95% e 100% disparados corretamente
- [ ] Créditos mensais zerados na renovação (sem rollover)
- [ ] Créditos avulsos não expiram entre ciclos

### Épico 3: Pagamentos (Asaas)
- [ ] Assinatura mensal criada no Asaas e renovada automaticamente
- [ ] Pix, boleto e cartão de crédito funcionam para assinatura e avulso
- [ ] Webhook `PAYMENT_RECEIVED` credita créditos mensais corretamente
- [ ] Webhook `PAYMENT_OVERDUE` concede 2 créditos de emergência
- [ ] Conta suspensa após 7 dias sem pagamento regularizado
- [ ] Upgrade e downgrade funcionam sem perder créditos avulsos

### Épico 4: Motor de Análise (v2.2 adaptado)
- [ ] Toda a lógica existente da v2.2 funciona identicamente
- [ ] Verificação de crédito ocorre antes do processamento
- [ ] PDF nunca é gravado em disco — processado em memória e descartado
- [ ] Laudo salvo no banco (JSONB) vinculado ao tenant e usuário
- [ ] Audit log registra cada análise com tipo de crédito consumido

### Épico 5: Multi-tenant e Equipe
- [ ] Tenant owner pode convidar membros (até o limite do plano)
- [ ] Créditos são compartilhados no pool do tenant
- [ ] Histórico de análises mostra o usuário que gerou cada laudo
- [ ] Um tenant não consegue acessar dados de outro tenant

### Épico 6: Admin Panel
- [ ] Dashboard com MRR, ARR, churn, laudos gerados
- [ ] Listagem de tenants com filtros
- [ ] Adição manual de créditos com registro de motivo
- [ ] Controle de vagas do Plano Fundador

---

## 11. Fora de Escopo (v3.0)

Itens **intencionalmente excluídos** desta versão:

- Integração automática com API da OAB para validação de número
- App mobile nativo (iOS/Android)
- Upload em lote (múltiplos PDFs simultâneos)
- Marketplace de templates de petição
- IA generativa para sugestão de tese jurídica
- Integração com PJe, e-SAJ ou outros sistemas processuais
- White-label para revenda

---

## 12. Stack Tecnológica Definida

### Frontend
- **React 18 + Vite** (mantido da v2.2)
- Adicionar: React Router v6, Zustand (estado global), React Query

### Backend
- **Node.js + Express** (mantido da v2.2)
- **PostgreSQL** em VPS própria
- ORM: **Prisma** (migrations, type safety)
- Auth: JWT + bcrypt (implementação própria)
- Pagamentos: **Asaas SDK / API REST**
- E-mail transacional: Resend ou Nodemailer + SMTP

### Infraestrutura (VPS própria)
- Sistema: Ubuntu LTS com Docker Compose
- Proxy reverso: Nginx + Certbot (HTTPS)
- Serviços: backend (Node), PostgreSQL, Nginx
- Backups: dump automático do Postgres diário

---

## 13. Roadmap de Lançamento

```
FASE 0 — Pré-lançamento (2-3 semanas)
├── [ ] Auth + cadastro + trial de 3 créditos
├── [ ] PostgreSQL na VPS + schema inicial (Prisma)
├── [ ] Integração Asaas (assinatura + avulso + webhooks)
├── [ ] Dashboard com saldo de créditos
├── [ ] Motor de análise adaptado (crédito guard + sem salvar PDF)
├── [ ] Landing page com tabela de planos
└── [ ] Domínio próprio + HTTPS (Nginx + Certbot)

FASE 1 — Fundadores (semanas 1-4)
├── [ ] Abrir 25 vagas de fundador (R$ 197, 40 laudos, 12 meses)
├── [ ] Onboarding assistido individual
├── [ ] Coleta de depoimentos e estudos de caso
└── [ ] Ajustes baseados no feedback dos primeiros usuários

FASE 2 — Abertura Pública (mês 2-3)
├── [ ] Plano Profissional (R$ 297) como âncora
├── [ ] Avulso (R$ 79) ativo como porta de entrada
├── [ ] Publicar estudos de caso dos fundadores
├── [ ] Webinar quinzenal de demonstração ao vivo
└── [ ] Meta: 10+ assinantes pagantes (break-even ~R$ 2.500/mês)

FASE 3 — Escala (mês 4+)
├── [ ] Planos Escritório (R$ 597) e Massa (R$ 1.990) com multi-usuário
├── [ ] Programa de indicação (1 mês grátis por conversão)
├── [ ] Admin panel com métricas completas
├── [ ] Plano anual com desconto (10× mensalidade)
└── [ ] Migrar geocodificação para LocationIQ (provedor pago)
```

---

## 14. Métricas de Sucesso

| Métrica | Meta (mês 3) | Meta (mês 6) |
|---------|-------------|-------------|
| Assinantes pagantes | 10 | 42 |
| MRR | R$ 2.970 | R$ 14.467 |
| ARR projetado | R$ 35.640 | R$ 173.604 |
| Churn mensal | < 5% | < 3% |
| Taxa de ativação (1º laudo em 48h) | > 70% | > 80% |
| Conversão trial → pago | > 30% | > 40% |
| Laudos gerados/mês | 400 | 1.680 |
| NPS | > 40 | > 60 |
| Custo fixo mensal | R$ 2.500 | R$ 2.500 |
| Break-even | ≥ 10 assin. | ✅ |

---

*Versão final após decisões de produto tomadas em julho/2026. Próximo passo: iniciar FASE 0 do roadmap.*
