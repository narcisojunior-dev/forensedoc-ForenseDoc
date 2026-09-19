# AUDITORIA DE SEGURANÇA — ForenseDoc (varredura completa + correção)

## Papel
Você é um pentester/AppSec sênior atuando com autorização total sobre ESTA base de
código, que é do próprio dono. Faça uma auditoria de segurança completa do backend
(Node/Express/Prisma) e do frontend (React/Vite), encontre brechas e CORRIJA-AS,
seguindo as regras de segurança de trabalho abaixo.

## Referenciais
Avalie contra:
- OWASP Top 10 2021 (A01–A10)
- OWASP API Security Top 10 2023 (API1–API10)
- OWASP ASVS (níveis 1–2)
Cruze com as classes de ataque de pentest dinâmico: IDOR/quebra de autorização,
escalonamento horizontal/vertical, abuso de lógica de negócio, injeção
(SQL/NoSQL/command/template), SSRF, path traversal, upload malicioso, XSS/CSRF,
desserialização, exposição de segredos, race conditions.

## Regras de trabalho (INEGOCIÁVEIS)
1. NÃO altere nada em produção, `.env*`, chaves ou segredos reais. Trabalhe só no código.
2. Antes de corrigir, PROVE a falha: descreva o cenário concreto (entrada → efeito),
   com arquivo:linha. Se não conseguir provar, marque como "suspeita" e NÃO altere.
3. Corrija UMA categoria por vez. Após cada correção, rode a suíte de testes
   (`npm test` no backend e no frontend). Se quebrar teste, conserte ou reverta antes
   de seguir.
4. Adicione teste de regressão para cada falha de segurança corrigida.
5. PARE e pergunte antes de mudanças que alterem comportamento de negócio, regra de
   crédito/billing, política de CORS/CSP, ou expiração de token. Nunca decida sozinho.
6. Não introduza dependências novas sem justificar. Prefira corrigir com o que já existe.
7. Não relaxe controles existentes (helmet, rate-limit, allowlists) para "passar" um teste.

## Escopo por área (o que caçar, específico desta app)

### A. Autorização e multi-tenant (PRIORIDADE MÁXIMA — API1/API3/A01)
- Toda rota que recebe um ID (laudo, dossiê, crédito, réplica, tenant, notificação):
  o handler verifica que o recurso PERTENCE ao tenant/usuário autenticado, ou confia
  no ID do request? Procure IDOR em `routes/` + `controllers/` + queries Prisma.
- Escalonamento vertical: rota de admin sem checagem de role? `adminRoutes` protegido
  por middleware de fato em TODAS as rotas, inclusive as novas?
- Vazamento entre tenants em listagens, agregações e no worker BullMQ (o job carrega
  o tenant certo?).

### B. Lógica de negócio — créditos e billing (API6/A04)
- É possível gerar laudo/dossiê SEM debitar crédito? Débito é atômico ou tem
  race condition (duas requisições paralelas gastando o mesmo crédito)?
- Webhook Asaas: replay (evento repetido credita duas vezes)? A verificação de token
  em tempo constante e a allowlist de IP cobrem TODOS os endpoints de webhook?
- Manipulação de valores/planos no request do checkout.

### C. Autenticação e sessão (A07/API2)
- JWT: algoritmo fixo (sem `alg:none`), segredo forte, expiração curta, verificação
  de assinatura. Refresh token em cookie: HttpOnly, Secure, SameSite, rotação e
  revogação no logout.
- CSRF: o `csrfGuard` cobre TODAS as rotas de mutação com cookie? Fluxo de reset de
  senha (token único, expira, invalida após uso, sem enumeração de e-mail).
- Rate limit real em login, reset e endpoints caros (OCR/geração).

### D. Injeção e entrada (A03/API8)
- Prisma: alguma query raw (`$queryRaw`/`$executeRaw`) concatenando input? Todo input
  externo validado por Zod ANTES de tocar em banco/fila/arquivo?
- Command/path injection nos scripts, no OCR (tesseract) e na escrita do upload.

### E. Upload do dossiê + OCR (A04/A08)
- Validação de tipo/tamanho/quantidade; nome de arquivo sanitizado (sem path
  traversal); armazenamento fora de rota servível; PDF-bomb/DoS; conteúdo extraído
  por OCR/pdf-parse que depois entra no laudo sem sanitização (injeção no PDF gerado).

### F. SSRF e saída (A10)
- Qualquer fetch/HTTP que use URL vinda do usuário (webhook, imagem, callback)?
  Bloqueia IP interno/metadata?

### G. Configuração e exposição (A05/A02/API7)
- Helmet/CSP ativos e sem `unsafe-inline` desnecessário; CORS não usa `*` com
  credenciais; erros não vazam stack/segredo; sem segredo hardcoded no código ou no
  frontend (`grep` por chave/token/senha); logs não gravam PII/credencial.
- Dependências: rode `npm audit` no backend e frontend; corrija o que for
  explorável sem quebrar.

### H. Frontend (A03/A05)
- XSS: uso de `dangerouslySetInnerHTML` / render de HTML vindo do backend/OCR sem
  sanitizar; tokens em `localStorage` vs cookie; segredo embutido no bundle.

### I. Vazamento de dados sensíveis via console e logs (A09/A02/API7)
Objetivo: nenhum dado sensível pode sair por console do navegador nem por log do servidor.

Frontend (console do navegador):
- Faça `grep -rn "console\.\(log\|debug\|info\|warn\|error\|table\|dir\)" frontend/src`.
- Sinalize qualquer console.* que exponha: token/JWT, resposta de API com dados de
  usuário/tenant, PII do dossiê, e-mail, CPF, dados de pagamento, config/segredo.
- Verifique se o build de produção REMOVE os console.* (drop_console no Vite/terser)
  ou se eles vão parar no bundle publicado.

Backend (stdout/stderr e logs estruturados):
- Faça `grep -rn "console\.\(log\|error\|warn\|info\|debug\)" backend/src backend/server.js`.
- Sinalize log que grave: corpo de request bruto, headers (Authorization/Cookie),
  senha, hash, token de refresh, JWT, DATABASE_URL/REDIS_URL, token da Asaas,
  variável de ambiente, ou `err`/objeto de erro completo em rota de auth/billing.
- Confirme que erros logados são sanitizados (mensagem, não o objeto inteiro) e que
  não há PII do dossiê/OCR nos logs.
- Verifique se em produção o nível de log não é debug/verbose.

Correção esperada:
- Remover o console.* ou trocar por logger com redaction dos campos sensíveis.
- Ativar remoção de console no build de produção do frontend.
- Adicionar teste/checagem que falhe se um console.* reaparecer em caminho sensível.


## Entregável
Ao final, produza um relatório em Markdown com:
1. O que já estava feito, da forma correta.
2. O que estava feito mas precisava de correção. Mostre o antes e o depois, e o teste de regressão criado.
3. Sumário: nº de achados por severidade (Crítico/Alto/Médio/Baixo).
4. Para cada achado: ID, categoria OWASP, severidade, arquivo:linha, cenário de
   exploração provado, correção aplicada (diff resumido) e teste de regressão criado.
5. Lista de itens que PAREI para te consultar (com o motivo).
6. Resultado do `npm test` antes e depois.
Comece pela área A e vá em ordem de prioridade. Não pule a verificação.
