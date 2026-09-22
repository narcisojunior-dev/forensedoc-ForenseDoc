# 🚀 Guia de Serviços e Assinaturas — ForenseDoc v3.0

> **Objetivo:** Roteiro direto ao ponto com todos os serviços externos que você precisa assinar, criar conta ou obter chaves para colocar o ForenseDoc no ar hoje na **Hostinger VPS KVM 4**.

---

## 📌 1. Tabela Resumo: Direto ao Ponto

| # | Serviço | Categoria | Plano Recomendado | Custo Estimado | Link Direto |
|---|---|---|---|---|---|
| **1** | **Hostinger** | VPS & Domínio | VPS KVM 4 + Registro `.com.br` | ~R$ 45 a 80/mês | [Acessar hPanel](https://hpanel.hostinger.com/) |
| **2** | **Asaas** | Pagamentos / PIX | Conta PJ Produção | Gratuito (taxa por venda) | [Criar Conta Asaas](https://www.asaas.com/) |
| **3** | **LocationIQ** | Geocodificação (Nominatim) | Starter / Developer | Gratuito até 5k req/dia (ou ~$10/mês) | [Criar Conta LocationIQ](https://locationiq.com/) |
| **4** | **Resend** (ou Brevo) | E-mail Transacional (SMTP) | Free Tier (3.000 e-mails/mês) | Grátis | [Criar Conta Resend](https://resend.com/) |
| **5** | **Geoapify** | Mapas Estáticos (PDF) | Free Tier (3.000 créditos/dia) | Grátis (sem cartão) | [Criar Conta Geoapify](https://myprojects.geoapify.com/) |
| **6** | **Cloudflare** | DNS & Segurança | Free Plan | Grátis | [Criar Conta Cloudflare](https://dash.cloudflare.com/sign-up) |

---

## 🛑 O que você NÃO precisa assinar (Economia e Privacidade)

* ❌ **Nenhuma API de Inteligência Artificial (OpenAI, Anthropic, Gemini):** O sistema utiliza motor pericial determinístico próprio com extração de texto via Poppler e OCR 100% local com Tesseract.js (modelos embutidos). Custo de IA = R$ 0,00.
* ❌ **Banco de dados ou Redis em nuvem (RDS, Supabase, Upstash):** O PostgreSQL 16 e o Redis 7 já sobem automaticamente em containers Docker otimizados dentro da sua VPS KVM 4 (16 GB de RAM).
* ❌ **Storage Externo S3 / Cloudflare R2:** Por conformidade rigorosa com a **LGPD (Art. 33 - vedação de transferência internacional de dados de terceiros)**, os PDFs dos dossiês são gravados no disco local da VPS (`/app/data/uploads`) com purga automática a cada 30 dias.

---

## 🔑 2. Detalhamento dos Serviços Obrigatórios

---

### 1. Hostinger (VPS KVM 4 & Domínio)
* **Função:** Hospedagem de todos os serviços (Nginx, Node API, Worker BullMQ, Postgres e Redis) e resolução do domínio oficial.
* **Link Direto:** [https://hpanel.hostinger.com/](https://hpanel.hostinger.com/)
* **Ações:**
  1. Acessar o painel da VPS KVM 4 (Ubuntu 22.04 ou 24.04 LTS recomendado).
  2. Anotar o **IP Público da VPS** (ex: `185.xxx.xxx.xxx`).
  3. No gerenciador de DNS do seu domínio, criar um **Registro A** apontando para o IP da VPS.
  4. Habilitar uma caixa de e-mail humana para contato institucional e solicitações LGPD (ex: `contato@forensedoc.com.br`).

---

### 2. Asaas (Gateway de Pagamentos & Cobranças)
* **Função:** Processamento de pagamentos de planos e créditos avulsos via PIX, Boleto e Cartão de Crédito, além do recebimento de Webhooks para liberar créditos automaticamente.
* **Link Direto:** [https://www.asaas.com/](https://www.asaas.com/)
* **Ações no Painel do Asaas:**
  1. Concluir a homologação da conta PJ para liberar o modo **Produção**.
  2. Ir em **Configurações da Conta** → **Integrações** → **Chaves de API** e gerar uma nova chave de API.
     * Esta chave será o seu `ASAAS_API_KEY`.
  3. Ir na aba **Webhooks** e cadastrar o webhook de pagamentos:
     * **URL do Webhook:** `https://forensedoc.com.br/api/webhooks/asaas`
     * **Versão da API:** v3
     * **Eventos:** Marcar eventos de pagamento (`PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, etc.).
     * **Token de Autenticação:** Defina uma sequência segura de texto (ou gere com `openssl rand -hex 16`).
     * Este token será o seu `ASAAS_WEBHOOK_TOKEN`.
  4. **Variáveis de Ambiente:**
     ```env
     ASAAS_API_KEY=sua_chave_de_producao
     ASAAS_WEBHOOK_TOKEN=seu_token_definido_no_webhook
     ASAAS_ENV=production
     ASAAS_WEBHOOK_IPS=52.67.12.206,18.230.8.159,54.94.136.112,54.94.183.101
     ```

---

### 3. LocationIQ (Geocodificação de Endereço Comercial)
* **Função:** Converte o endereço físico residencial do contratante em latitude e longitude, base para o Confronto Pericial de Geodistância (Haversine).
* **Por que é obrigatório:** O serviço público do OpenStreetMap (`nominatim.openstreetmap.org`) bloqueia por IP do servidor requisições comerciais automatizadas sem aviso. Para produção é indispensável um endpoint comercial compatível.
* **Link Direto:** [https://locationiq.com/](https://locationiq.com/)
  *(Alternativa direta: [https://geocode.earth/](https://geocode.earth/))*
* **Ações:**
  1. Crie uma conta no LocationIQ (o plano gratuito inicial oferece até 5.000 requisições/dia, o que cobre com imensa folga os primeiros meses).
  2. No painel, copie o **Access Token (API Key)**.
  3. **Variáveis de Ambiente:**
     ```env
     NOMINATIM_BASE_URL=https://us1.locationiq.com/v1
     NOMINATIM_API_KEY=seu_token_locationiq_aqui
     NOMINATIM_KEY_PARAM=key
     NOMINATIM_USER_AGENT=ForenseDoc/3.0 (contato@forensedoc.com.br)
     ```

---

### 4. Resend ou Brevo (E-mails Transacionais / SMTP)
* **Função:** Envio imediato de confirmação de cadastro, validação de e-mail, tokens de recuperação de senha e notificações de vencimento/faturas.
* **Opção Recomendada (Mais simples e moderna):** **Resend**
  * **Link Direto:** [https://resend.com/](https://resend.com/)
  * **Plano:** Gratuito (3.000 e-mails/mês, até 100 e-mails/dia).
  * **Ações:**
    1. Crie a conta e adicione o seu domínio (`forensedoc.com.br`).
    2. Configure os registros DNS (DKIM, SPF e MX) indicados pelo Resend no seu gerenciador de DNS (Cloudflare ou Hostinger).
    3. Vá em **API Keys** e crie uma nova chave.
    4. Em **Settings** → **SMTP**, pegue os dados de conexão SMTP:
  * **Variáveis de Ambiente:**
    ```env
    SMTP_HOST=smtp.resend.com
    SMTP_PORT=587
    SMTP_USER=resend
    SMTP_PASS=re_sua_api_key_aqui
    EMAIL_FROM=ForenseDoc <noreply@forensedoc.com.br>
    ```
* **Opção Alternativa (Se preferir maior cota diária):** **Brevo (antigo Sendinblue)**
  * **Link Direto:** [https://www.brevo.com/](https://www.brevo.com/) (300 e-mails/dia gratuitos).
  * Configuração: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`.

---

## 🎨 3. Serviços Complementares e Gratuitos

---

### 5. Geoapify (Mapas Visuais para o Laudo em PDF)
* **Função:** Gera a imagem PNG do mapa com as marcações geográficas reais embutidas na folha de geolocalização (§ 5) do laudo pericial.
* **Link Direto:** [https://myprojects.geoapify.com/](https://myprojects.geoapify.com/)
* **Plano:** Gratuito (3.000 créditos por dia, sem exigir cartão de crédito). Com o cache de 6 horas do sistema, suporta até 1.000 laudos/dia tranquilamente.
* **Ações:**
  1. Crie uma conta no Geoapify.
  2. Crie um novo projeto (ex: `ForenseDoc Produção`).
  3. Copie a chave de API gerada.
* **Variável de Ambiente:**
  ```env
  GEOAPIFY_KEY=sua_chave_geoapify_aqui
  ```
  *(Nota: Se essa chave estiver vazia, o laudo é emitido normalmente com a tabela de coordenadas, apenas sem a imagem renderizada do mapa).*

---

### 6. Cloudflare (DNS Rápido, SSL e Proteção)
* **Função:** Gerenciamento dos registros de DNS do domínio com propagação em segundos, além de proteção DDoS gratuita e terminação SSL complementar.
* **Link Direto:** [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
* **Ações:**
  1. Crie uma conta gratuita e adicione seu domínio.
  2. Altere os nameservers no Registro.br ou Hostinger para os nameservers informados pela Cloudflare.
  3. Crie os registros `A` apontando `@` e `www` para o IP da VPS KVM 4.
  4. (Dica de SSL): Caso use Let's Encrypt diretamente no Nginx com Certbot, configure o SSL na Cloudflare como **Full (Strict)**.

---

## 📋 4. Checklist Completo para o Arquivo `.env.production`

Ao conectar via SSH na VPS KVM 4, você preencherá o arquivo `forensedoc-ForenseDoc/backend/.env.production`. 

Abaixo está o modelo consolidado com todas as chaves obtidas nos serviços acima:

```env
# ── Servidor ──
NODE_ENV=production
PORT=8787

# ── Banco de Dados & Cache (Containers Locais da KVM 4) ──
DATABASE_URL=postgresql://forensedoc_app:SENHA_FORTE_DO_POSTGRES@postgres:5432/forensedoc_prod
REDIS_URL=redis://:SENHA_FORTE_DO_REDIS@redis:6379
REDIS_PASSWORD=SENHA_FORTE_DO_REDIS
REDIS_MAXMEMORY=1gb

# ── Autenticação JWT (Gere com: openssl rand -base64 32) ──
JWT_SECRET=VALOR_ALEATORIO_SEGURO_GERADO_NO_TERMINAL
JWT_ACCESS_EXPIRES=15m

# ── Domínios & URLs Públicas ──
FRONTEND_URL=https://forensedoc.com.br
CORS_ORIGIN=https://forensedoc.com.br

# ── Administrador da Plataforma ──
PLATFORM_ADMIN_EMAIL=seu_email@escritorio.com.br
# Descubra seu IP com: curl -s ifconfig.me
ADMIN_ALLOWED_IPS=SEU_IP_AQUI/32
ADMIN_REQUIRE_TOTP=true

# ── 1. Asaas (Gateway de Pagamentos) ──
ASAAS_API_KEY=CHAVE_OBTIDA_NO_PAINEL_ASAAS
ASAAS_WEBHOOK_TOKEN=TOKEN_CRIADO_NO_WEBHOOK_ASAAS
ASAAS_ENV=production
ASAAS_WEBHOOK_IPS=52.67.12.206,18.230.8.159,54.94.136.112,54.94.183.101

# ── 2. E-mail Transacional (Resend ou Brevo) ──
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=CHAVE_API_DO_RESEND
EMAIL_FROM=ForenseDoc <noreply@forensedoc.com.br>

# ── 3. Geocodificação Comercial (LocationIQ) ──
NOMINATIM_BASE_URL=https://us1.locationiq.com/v1
NOMINATIM_API_KEY=CHAVE_OBTIDA_NO_LOCATIONIQ
NOMINATIM_KEY_PARAM=key
NOMINATIM_USER_AGENT=ForenseDoc/3.0 (contato@forensedoc.com.br)

# ── 4. Mapas Estáticos do Laudo (Geoapify) ──
GEOAPIFY_KEY=CHAVE_OBTIDA_NO_GEOAPIFY

# ── Armazenamento de Dossiês (Disco Local - LGPD Art. 33) ──
UPLOAD_DIR=/app/data/uploads
UPLOAD_RETENTION_DAYS=30
AUDIT_RETENTION_DAYS=365
NOTIFICATION_RETENTION_DAYS=180

# ── Segurança e Checagens ──
PASSWORD_BREACH_CHECK=true
COERENCIA_BLOQUEANTE=false
```

---

## 🎯 5. Ordem Prática de Execução Hoje

1. **Assinar / Criar as contas nos 4 serviços essenciais:**
   - [Asaas](https://www.asaas.com/) (Obter API Key e definir Webhook Token)
   - [LocationIQ](https://locationiq.com/) (Obter Token de API)
   - [Resend](https://resend.com/) (Validar domínio e obter credencial SMTP)
   - [Geoapify](https://myprojects.geoapify.com/) (Obter Chave gratuita de mapas)
2. **Configurar o DNS:**
   - Criar registro `A` no domínio apontando para o IP da VPS Hostinger KVM 4.
3. **Conectar na VPS via SSH e clonar o projeto:**
   - Seguir o roteiro detalhado em [`PRODUCAO.md`](../documentação/PRODUCAO.md).
4. **Preencher `.env` na raiz e `backend/.env.production`** com as chaves recolhidas.
5. **Executar `docker compose up -d`** e conferir a saúde do sistema em `https://forensedoc.com.br/api/health`.
