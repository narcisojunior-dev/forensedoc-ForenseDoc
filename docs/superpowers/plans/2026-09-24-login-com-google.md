# Login com Google: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir entrar e se cadastrar no ForenseDoc com uma conta Google, mantendo o aceite versionado dos termos, o CPF/CNPJ obrigatório do escritório e o segundo fator (TOTP) de quem já o ativou.

**Architecture:** O frontend carrega o Google Identity Services (GIS) em modo popup e recebe um ID token assinado pelo Google. O backend valida esse token com `google-auth-library` (assinatura, emissor, validade e `aud` igual ao nosso Client ID) e procura a conta pelo `sub` do Google, depois pelo e-mail. Conta encontrada passa pelo mesmo final de login que a senha usa (`concluirLogin`: desafio TOTP ou sessão). Conta inexistente recebe um ticket assinado de 20 minutos, e a tela `/cadastro-google` coleta CPF/CNPJ, OAB e aceite dos termos antes de criar escritório e titular pela mesma função do cadastro por senha (`criarEscritorioETitular`).

**Tech Stack:** Node 20, Express 4, Prisma 7 + Postgres, `jsonwebtoken` 9, `google-auth-library` (nova), Zod 4, Vitest + Supertest no backend; React 18, Vite 5, Zustand 5, React Router 7, Tailwind 3, Vitest + Testing Library no frontend.

## Global Constraints

- Uma única dependência nova: `google-auth-library` no backend. O frontend não ganha pacote: o script do GIS é carregado em tempo de execução de `https://accounts.google.com/gsi/client`.
- Comentários de código em português, explicando o porquê da decisão e não o que a linha faz. É o padrão de todo o repositório.
- Mensagens de erro ao usuário em português; o campo `code` em inglês maiúsculo (`GOOGLE_TOKEN_INVALID`), que é o padrão das respostas existentes.
- Textos de interface e documentação sem travessão (—). Usar vírgula, dois-pontos ou frase nova.
- A funcionalidade é desligável por ambiente: sem `GOOGLE_CLIENT_ID` o backend responde 404 nas rotas do Google; sem `VITE_GOOGLE_CLIENT_ID` o botão não aparece. Nenhum dos dois pode quebrar o login por senha.
- Testes com Vitest nos dois lados. Backend: `cd backend && npx vitest run`. Frontend: `cd frontend && npx vitest run`.
- `git` do sistema falha por licença do Xcode neste ambiente. Usar `/opt/homebrew/bin/git`.
- Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (os comandos abaixo já a incluem).
- O ambiente local sobe com `bash start-dev.sh` na raiz de `forensedoc-ForenseDoc` (o script não tem bit de execução). Postgres local na porta 55432.
- Migrations: `cd backend && DATABASE_URL=postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev npx prisma migrate dev --name <nome>`.

---

## Decisões de projeto

Várias escolhas abaixo contrariam o caminho óbvio. Quem for implementar precisa saber o motivo antes de "simplificar" alguma delas.

### 1. ID token pelo GIS, e não o fluxo OAuth com redirecionamento

O fluxo clássico (redirecionar para o Google, voltar com `code`, trocar por token no servidor) exige client secret guardado no backend, uma rota de callback e um parâmetro `state` contra CSRF. O GIS em modo popup entrega direto ao JavaScript da página um ID token (JWT assinado pelo Google), que o frontend envia por `POST /api/auth/google`. Consequências:

- Não existe client secret. O Client ID é público por natureza.
- A requisição sai da nossa origem e passa pelo `csrfGuard` que já protege `/api/auth/*`.
- Não precisamos de token de acesso às APIs do Google: queremos só a identidade. O escopo é o mínimo (`openid email profile`), sem acesso a Drive, Gmail nem nada além.

### 2. A conta é identificada pelo `sub`, não pelo e-mail

O `sub` é o identificador estável da conta Google e não muda quando o e-mail muda. O e-mail só é usado uma vez, para vincular no primeiro login. Depois disso a busca é por `googleSub`, que ganha coluna própria com índice único.

Se já existe um usuário com o mesmo e-mail vinculado a OUTRO `sub`, o login é recusado (`GOOGLE_ACCOUNT_MISMATCH`). Isso acontece quando uma conta Google Workspace é apagada e recriada com o mesmo endereço, e aceitar em silêncio entregaria a conta do ForenseDoc a uma identidade Google diferente da que foi vinculada.

### 3. Vínculo automático só com conta de e-mail JÁ CONFIRMADO

Esta decisão ajusta o que foi combinado antes ("o login com Google dá a conta como confirmada"). O motivo é um ataque conhecido como sequestro prévio de conta:

1. O atacante cadastra, com senha, o e-mail da vítima. A conta fica com `emailVerified = false`, porque ele não recebe o link.
2. A vítima entra com o Google. Se o sistema vinculasse e marcasse o e-mail como confirmado, a conta passaria a aceitar também a senha que o atacante escolheu, e o escritório teria o CPF/CNPJ e o nome que o atacante digitou.

Por isso: conta com e-mail confirmado é vinculada na hora; conta com e-mail pendente recebe `409 GOOGLE_EMAIL_PENDING_VERIFICATION`, com orientação para confirmar pelo link enviado no cadastro. O dono legítimo que se cadastrou por senha e nunca clicou no link perde um passo; o atacante perde o ataque inteiro.

### 4. Cadastro novo: ticket assinado, e o e-mail vem do ticket

Quando o Google confirma a identidade e não existe conta, o backend devolve `{ cadastroPendente: true, ticket, email, name }`. O ticket é um JWT de 20 minutos assinado com um segredo DERIVADO do `JWT_SECRET` (mesmo padrão do desafio TOTP em `backend/src/utils/jwt.js`), com `typ: "google-signup"`. Assim ele não é aceito como access token nem como desafio TOTP, e vice-versa.

Na conclusão (`POST /api/auth/google/complete`), e-mail e `sub` saem do ticket. O corpo da requisição traz só o que o Google não fornece: nome (pré-preenchido, editável), CPF/CNPJ, OAB e versão dos termos. Qualquer campo `email` no corpo é descartado pelo Zod. Aceitar o e-mail do corpo permitiria criar conta verificada para um endereço que ninguém provou possuir.

O aceite dos termos segue idêntico ao cadastro por senha: versão exigida, gravada em `User.termsVersion` e no `audit_logs` com IP e navegador, dentro da mesma transação. É a mesma função (`criarEscritorioETitular`) nos dois caminhos, para que um não possa divergir do outro.

### 5. Senha inutilizável em vez de `passwordHash` nulo

Conta criada pelo Google recebe como `passwordHash` o bcrypt de 32 bytes aleatórios que ninguém conhece. A alternativa (tornar a coluna opcional) obrigaria a tratar `null` em login, troca de senha, painel administrativo e em qualquer código futuro que leia a coluna. Com o hash aleatório, o login por senha simplesmente falha com a mesma mensagem genérica de sempre, e quem quiser passar a ter senha usa "Esqueci a senha", que prova posse do e-mail.

### 6. TOTP continua valendo depois do Google

O trecho final do login (desafio TOTP quando ativo; senão sessão, `lastLoginAt` e auditoria) sai de `login` para uma função exportada, `concluirLogin`, usada pelo login por senha e pelo login com Google. O desafio devolvido tem o mesmo formato, então a rota `/api/auth/totp/verify` e a tela do código funcionam sem mudança. Entrar com Google nunca é atalho para pular o segundo fator.

### 7. A resposta do Google revela se o e-mail tem conta, e isso é aceitável

O cadastro por senha responde igual para e-mail novo e e-mail existente, para não virar verificador de contas. Aqui a resposta difere (`cadastroPendente` versus sessão), mas só para quem apresentou um ID token válido daquele e-mail, ou seja, o próprio dono. Não há o que enumerar.

---

## Mapa de arquivos

**Backend**

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/services/googleIdentityService.js` | Criar | Validar o ID token e devolver `{ sub, email, emailVerified, name }` |
| `backend/src/utils/jwt.js` | Modificar | Emitir e validar o ticket de cadastro pendente |
| `backend/prisma/schema.prisma` | Modificar | Coluna `User.googleSub` única |
| `backend/prisma/migrations/<timestamp>_user_google_sub/migration.sql` | Criar (gerado) | Migração da coluna |
| `backend/src/utils/cadastroSchema.js` | Criar | Campos Zod do escritório, comuns aos dois cadastros |
| `backend/src/controllers/authController.js` | Modificar | Extrair `criarEscritorioETitular` e `concluirLogin`; usar `camposDoEscritorio` |
| `backend/src/controllers/googleAuthController.js` | Criar | `googleLogin` e `googleCompleteSignup` |
| `backend/src/routes/authRoutes.js` | Modificar | `POST /google` e `POST /google/complete` com limitadores |
| `backend/.env.example` | Modificar | `GOOGLE_CLIENT_ID` |
| `backend/tests/googleIdentityService.test.js` | Criar | |
| `backend/tests/googleSignupTicket.test.js` | Criar | |
| `backend/tests/criarEscritorioETitular.test.js` | Criar | |
| `backend/tests/concluirLogin.test.js` | Criar | |
| `backend/tests/googleLogin.test.js` | Criar | |
| `backend/tests/googleCompleteSignup.test.js` | Criar | |
| `backend/tests/googleRoutes.test.js` | Criar | |

**Frontend**

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `frontend/src/components/GoogleButton.jsx` | Criar | Carregar o GIS e renderizar o botão oficial |
| `frontend/src/store/authStore.js` | Modificar | `loginGoogle` e `completarCadastroGoogle` |
| `frontend/src/hooks/useEntrarComGoogle.js` | Criar | Tratar as quatro respostas do login com Google; `destinoAposLogin` |
| `frontend/src/pages/Login.jsx` | Modificar | Botão do Google; aceitar desafio TOTP vindo por `location.state` |
| `frontend/src/components/AceiteTermos.jsx` | Criar | Caixa de aceite única para os dois cadastros |
| `frontend/src/pages/CadastroGoogle.jsx` | Criar | Completar cadastro (nome, CPF/CNPJ, OAB, termos) |
| `frontend/src/pages/Register.jsx` | Modificar | Botão do Google; usar `AceiteTermos` |
| `frontend/src/App.jsx` | Modificar | Rota `/cadastro-google` |
| `frontend/.env.example` | Modificar | `VITE_GOOGLE_CLIENT_ID` |
| `frontend/src/tests/googleButton.test.jsx` | Criar | |
| `frontend/src/tests/authStoreGoogle.test.js` | Criar | |
| `frontend/src/tests/useEntrarComGoogle.test.jsx` | Criar | |
| `frontend/src/tests/loginGoogle.test.jsx` | Criar | |
| `frontend/src/tests/cadastroGoogle.test.jsx` | Criar | |

**Documentação:** `README.md` ganha a seção "Login com Google".

---

### Task 0: Branch de trabalho

- [ ] **Step 1: Criar a branch**

```bash
cd /Users/narcisojunior/Documents/repositorios/Forense_DOC/forensedoc-ForenseDoc
/opt/homebrew/bin/git status --short
/opt/homebrew/bin/git switch -c feat/login-google
```

Expected: `status` vazio e `Switched to a new branch 'feat/login-google'`. Se o `status` não estiver vazio, pare e pergunte ao usuário o que fazer com as mudanças pendentes.

---

### Task 1: Serviço de verificação do ID token

**Files:**
- Create: `backend/src/services/googleIdentityService.js`
- Modify: `backend/package.json` (via `npm install`)
- Test: `backend/tests/googleIdentityService.test.js`

**Interfaces:**
- Consumes: `normalizeEmail(value: string): string` de `backend/src/utils/stringUtils.js`.
- Produces:
  - `googleLoginHabilitado(): boolean`
  - `verificarCredencialGoogle(credential: string): Promise<{ sub: string, email: string, emailVerified: boolean, name: string }>`, que lança `CredencialGoogleInvalida` quando o token não vale.
  - `class CredencialGoogleInvalida extends Error`

- [ ] **Step 1: Instalar a dependência**

```bash
cd backend && npm install google-auth-library
```

Expected: `added N packages` e `google-auth-library` em `dependencies` do `backend/package.json`. Confirme que a versão instalada expõe `OAuth2Client.prototype.verifyIdToken`:

```bash
node -e "import('google-auth-library').then(m => console.log(typeof m.OAuth2Client.prototype.verifyIdToken))"
```

Expected: `function`

- [ ] **Step 2: Escrever o teste que falha**

`backend/tests/googleIdentityService.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A validação do ID token é o único ponto em que o sistema decide que uma
 * pessoa é dona de um e-mail sem ter mandado link nenhum. O que precisa ficar
 * preso aqui: a audiência é o NOSSO client ID (um token emitido para outro site
 * não pode abrir sessão aqui), qualquer falha da biblioteca vira o mesmo erro
 * tipado, e `email_verified` só conta quando é literalmente `true`.
 */

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(...args) {
      return verifyIdToken(...args);
    }
  },
}));

const CLIENT_ID = "cliente-teste.apps.googleusercontent.com";
const { verificarCredencialGoogle, googleLoginHabilitado, CredencialGoogleInvalida } =
  await import("../src/services/googleIdentityService.js");

function tokenCom(payload) {
  verifyIdToken.mockResolvedValue({ getPayload: () => payload });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
});

describe("googleLoginHabilitado", () => {
  it("depende só da presença do client ID", () => {
    expect(googleLoginHabilitado()).toBe(true);
    delete process.env.GOOGLE_CLIENT_ID;
    expect(googleLoginHabilitado()).toBe(false);
  });
});

describe("verificarCredencialGoogle", () => {
  it("valida contra o nosso client ID", async () => {
    tokenCom({ sub: "123", email: "fulano@gmail.com", email_verified: true, name: "Fulano" });

    await verificarCredencialGoogle("id-token");

    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: "id-token", audience: CLIENT_ID });
  });

  it("normaliza o e-mail como o resto do sistema", async () => {
    tokenCom({ sub: "123", email: "  Fulano@Gmail.COM ", email_verified: true, name: "Fulano" });

    const identidade = await verificarCredencialGoogle("id-token");

    expect(identidade).toEqual({
      sub: "123",
      email: "fulano@gmail.com",
      emailVerified: true,
      name: "Fulano",
    });
  });

  it("só considera o e-mail verificado quando o Google diz true", async () => {
    tokenCom({ sub: "123", email: "fulano@gmail.com", email_verified: "true" });
    expect((await verificarCredencialGoogle("id-token")).emailVerified).toBe(false);

    tokenCom({ sub: "123", email: "fulano@gmail.com" });
    expect((await verificarCredencialGoogle("id-token")).emailVerified).toBe(false);
  });

  it("devolve nome vazio quando o Google não manda nome", async () => {
    tokenCom({ sub: "123", email: "fulano@gmail.com", email_verified: true });
    expect((await verificarCredencialGoogle("id-token")).name).toBe("");
  });

  it("converte falha da biblioteca em CredencialGoogleInvalida", async () => {
    verifyIdToken.mockRejectedValue(new Error("Wrong recipient, payload audience != requiredAudience"));

    await expect(verificarCredencialGoogle("id-token")).rejects.toBeInstanceOf(CredencialGoogleInvalida);
  });

  it("recusa payload sem sub ou sem e-mail", async () => {
    tokenCom({ email: "fulano@gmail.com", email_verified: true });
    await expect(verificarCredencialGoogle("id-token")).rejects.toBeInstanceOf(CredencialGoogleInvalida);

    tokenCom({ sub: "123", email_verified: true });
    await expect(verificarCredencialGoogle("id-token")).rejects.toBeInstanceOf(CredencialGoogleInvalida);
  });

  it.each([undefined, "", 42, "x".repeat(4097)])(
    "recusa credencial malformada (%s) sem consultar o Google",
    async (credencial) => {
      await expect(verificarCredencialGoogle(credencial)).rejects.toBeInstanceOf(CredencialGoogleInvalida);
      expect(verifyIdToken).not.toHaveBeenCalled();
    }
  );
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd backend && npx vitest run tests/googleIdentityService.test.js`
Expected: FAIL com `Failed to load url ../src/services/googleIdentityService.js` (ou `Cannot find module`).

- [ ] **Step 4: Implementar**

`backend/src/services/googleIdentityService.js`:

```js
import { OAuth2Client } from "google-auth-library";
import { normalizeEmail } from "../utils/stringUtils.js";

/**
 * Validação do ID token entregue pelo Google Identity Services.
 *
 * O token é um JWT assinado pelo Google. A biblioteca oficial confere
 * assinatura (com as chaves públicas do Google, que ela baixa e mantém em
 * cache), emissor, validade e audiência. Fazer isso à mão exigiria acompanhar
 * a rotação das chaves, e erro nesse ponto abre sessão para qualquer um.
 *
 * A AUDIÊNCIA é a checagem que não pode faltar: sem ela, um ID token emitido
 * pelo Google para qualquer outro site do mundo abriria sessão aqui.
 */

export class CredencialGoogleInvalida extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = "CredencialGoogleInvalida";
  }
}

/** Lido a cada chamada para que o ambiente possa ligar e desligar sem reiniciar os testes. */
export function googleLoginHabilitado() {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

// Um cliente por processo: é ele que guarda o cache das chaves públicas.
let cliente;
function obterCliente() {
  cliente ??= new OAuth2Client();
  return cliente;
}

// Um ID token do Google tem em torno de 1 KB. O teto evita gastar verificação
// criptográfica com corpo arbitrariamente grande.
const TAMANHO_MAXIMO = 4096;

export async function verificarCredencialGoogle(credential) {
  if (typeof credential !== "string" || credential.length === 0 || credential.length > TAMANHO_MAXIMO) {
    throw new CredencialGoogleInvalida("credencial ausente ou malformada");
  }

  let payload;
  try {
    const ticket = await obterCliente().verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    throw new CredencialGoogleInvalida(err.message);
  }

  if (!payload?.sub || !payload?.email) {
    throw new CredencialGoogleInvalida("payload sem sub ou sem e-mail");
  }

  return {
    sub: payload.sub,
    email: normalizeEmail(payload.email),
    // Comparação estrita: só o booleano true do Google prova posse do e-mail.
    emailVerified: payload.email_verified === true,
    name: payload.name || "",
  };
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd backend && npx vitest run tests/googleIdentityService.test.js`
Expected: PASS, 10 testes.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add backend/package.json backend/package-lock.json backend/src/services/googleIdentityService.js backend/tests/googleIdentityService.test.js
/opt/homebrew/bin/git commit -m "feat(auth): validação do ID token do Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Coluna `googleSub` e ticket de cadastro pendente

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `User`, depois de `lastLoginAt`)
- Create: `backend/prisma/migrations/<timestamp>_user_google_sub/migration.sql` (gerado pelo Prisma, depois comentado)
- Modify: `backend/src/utils/jwt.js` (fim do arquivo)
- Test: `backend/tests/googleSignupTicket.test.js`

**Interfaces:**
- Produces:
  - `User.googleSub: String? @unique` no Prisma Client.
  - `generateGoogleSignupTicket({ googleSub: string, email: string, name: string }): string`
  - `verifyGoogleSignupTicket(token: string): { googleSub: string, email: string, name: string, typ: "google-signup" }`, que lança erro para token inválido, vencido ou de outro tipo.

- [ ] **Step 1: Escrever o teste que falha**

`backend/tests/googleSignupTicket.test.js`:

```js
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * O ticket prova que o Google confirmou a posse de um e-mail que ainda não tem
 * conta. É ele que autoriza criar uma conta JÁ VERIFICADA, então precisa ser
 * impossível confundi-lo com as outras credenciais do sistema, nos dois
 * sentidos, e ele precisa morrer em 20 minutos.
 */

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

const {
  generateGoogleSignupTicket,
  verifyGoogleSignupTicket,
  generateAccessToken,
  verifyAccessToken,
  generateTotpChallenge,
  verifyTotpChallenge,
} = await import("../src/utils/jwt.js");

const DADOS = { googleSub: "google-sub-1", email: "fulano@gmail.com", name: "Fulano" };

afterEach(() => {
  vi.useRealTimers();
});

describe("ticket de cadastro pelo Google", () => {
  it("faz ida e volta com os dados da identidade", () => {
    const payload = verifyGoogleSignupTicket(generateGoogleSignupTicket(DADOS));

    expect(payload).toMatchObject({ ...DADOS, typ: "google-signup" });
  });

  it("não vale como access token", () => {
    expect(() => verifyAccessToken(generateGoogleSignupTicket(DADOS))).toThrow();
  });

  it("não vale como desafio TOTP", () => {
    expect(() => verifyTotpChallenge(generateGoogleSignupTicket(DADOS))).toThrow();
  });

  it("access token e desafio TOTP não valem como ticket", () => {
    const access = generateAccessToken({ userId: "u1", tenantId: "t1" });
    const desafio = generateTotpChallenge({ userId: "u1", typ: "totp" });

    expect(() => verifyGoogleSignupTicket(access)).toThrow();
    expect(() => verifyGoogleSignupTicket(desafio)).toThrow();
  });

  it("vence em 20 minutos", () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T12:00:00Z") });
    const ticket = generateGoogleSignupTicket(DADOS);

    vi.setSystemTime(new Date("2026-09-24T12:19:00Z"));
    expect(() => verifyGoogleSignupTicket(ticket)).not.toThrow();

    vi.setSystemTime(new Date("2026-09-24T12:21:00Z"));
    expect(() => verifyGoogleSignupTicket(ticket)).toThrow();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd backend && npx vitest run tests/googleSignupTicket.test.js`
Expected: FAIL com `generateGoogleSignupTicket is not a function`.

- [ ] **Step 3: Implementar o ticket em `backend/src/utils/jwt.js`**

Acrescentar ao fim do arquivo:

```js
/**
 * Ticket de cadastro pendente pelo Google.
 *
 * Emitido quando o Google confirmou a posse de um e-mail que ainda não tem conta
 * aqui. Ele carrega o e-mail e o `sub` até a tela que coleta CPF/CNPJ e o aceite
 * dos termos, e é o que autoriza criar a conta já verificada. Por isso o
 * e-mail da conclusão sai daqui, nunca do corpo da requisição.
 *
 * Segredo derivado pelo mesmo motivo do desafio TOTP: um ticket assinado com o
 * segredo de acesso passaria como sessão válida em `verifyAccessToken`.
 *
 * Vinte minutos: tempo de achar o CPF/CNPJ e ler os termos, e não mais.
 */
const GOOGLE_SIGNUP_SECRET = crypto
  .createHmac("sha256", ACCESS_SECRET)
  .update("forensedoc:google-signup:v1")
  .digest("hex");

export function generateGoogleSignupTicket({ googleSub, email, name }) {
  return jwt.sign({ googleSub, email, name, typ: "google-signup" }, GOOGLE_SIGNUP_SECRET, {
    expiresIn: "20m",
  });
}

export function verifyGoogleSignupTicket(token) {
  const payload = jwt.verify(token, GOOGLE_SIGNUP_SECRET);
  if (payload.typ !== "google-signup") throw new Error("Ticket de tipo inválido.");
  return payload;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd backend && npx vitest run tests/googleSignupTicket.test.js`
Expected: PASS, 5 testes.

- [ ] **Step 5: Acrescentar a coluna no schema**

Em `backend/prisma/schema.prisma`, no model `User`, logo depois da linha `lastLoginAt     DateTime?`:

```prisma

  // ── Login com Google ────────────────────────────────────────────────────
  //
  // `sub` do ID token do Google: o identificador estável da conta Google, que
  // não muda quando o e-mail dela muda. O e-mail só é usado para vincular no
  // primeiro login; daí em diante a conta é encontrada por aqui.
  //
  // Nulo em quem nunca entrou pelo Google.
  googleSub       String?   @unique
```

- [ ] **Step 6: Gerar a migração**

Com o Postgres local de pé (`docker compose -f docker-compose.dev.yml up -d` na raiz de `forensedoc-ForenseDoc`):

```bash
cd backend && DATABASE_URL=postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev npx prisma migrate dev --name user_google_sub
```

Expected: `Your database is now in sync with your schema.` e uma pasta nova `prisma/migrations/<timestamp>_user_google_sub/`.

- [ ] **Step 7: Conferir e comentar o SQL gerado**

O `migration.sql` gerado deve conter exatamente estas duas instruções. Acrescente o comentário no topo, no padrão das migrações existentes:

```sql
-- Login com Google.
--
-- Coluna opcional: usuários existentes continuam entrando por senha sem mudança
-- nenhuma. O índice único garante que uma conta Google abra no máximo uma conta
-- do ForenseDoc.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");
```

Se o Prisma gerar qualquer outra instrução (por exemplo, mexendo em outra tabela), pare: o schema local está divergente do banco e isso precisa ser resolvido antes.

- [ ] **Step 8: Rodar a suíte inteira do backend**

Run: `cd backend && npx vitest run`
Expected: tudo PASS (o Prisma Client foi regenerado pelo `migrate dev`).

- [ ] **Step 9: Commit**

```bash
/opt/homebrew/bin/git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/utils/jwt.js backend/tests/googleSignupTicket.test.js
/opt/homebrew/bin/git commit -m "feat(auth): coluna googleSub e ticket de cadastro pelo Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Extrair criação de conta e final de login do `authController`

Refatoração sem mudança de comportamento no login e no cadastro por senha. Ela existe para que o Google use exatamente o mesmo código, e não uma cópia.

**Files:**
- Create: `backend/src/utils/cadastroSchema.js`
- Modify: `backend/src/controllers/authController.js` (schema de registro nas linhas 27-50; transação do `register` nas linhas 170-253; final do `login` nas linhas 343-377)
- Test: `backend/tests/criarEscritorioETitular.test.js`, `backend/tests/concluirLogin.test.js`

**Interfaces:**
- Consumes: `googleSub` do Prisma Client (Task 2).
- Produces:
  - `camposDoEscritorio` (objeto de campos Zod: `name`, `cpfCnpj`, `oabNumber`, `oabState`, `termsVersion`) em `backend/src/utils/cadastroSchema.js`.
  - `criarEscritorioETitular(tx, dados, req): Promise<{ tenant, user }>`, com `dados = { name, email, passwordHash, cpfCnpj, oabNumber?, oabState?, termsVersion, emailVerified?: boolean, googleSub?: string }`.
  - `concluirLogin(req, res, user, { acao?: string }): Promise<Response>`, onde `user` inclui `tenant`. Responde `{ totpRequired, challenge, recuperacaoDisponivel }` ou `{ accessToken }` com o cookie de refresh.

> **Por que `camposDoEscritorio` fica fora do `authController`:** `backend/tests/accountLockout.test.js` substitui o `authController` inteiro por um mock com exportações fixas. Um controller novo que lesse um schema exportado pelo `authController` no carregamento do módulo quebraria esse teste. Funções importadas e chamadas só dentro de handlers não têm esse problema, porque o mock só é consultado quando a função é chamada.

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/criarEscritorioETitular.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cadastro por senha e cadastro pelo Google precisam produzir o MESMO
 * escritório: mesmo bônus de laudos, mesmo registro de aceite dos termos. A
 * função é compartilhada justamente para que um caminho não possa divergir do
 * outro; estes testes prendem as duas diferenças legítimas (e-mail verificado e
 * vínculo com o Google) e o que precisa ser igual.
 */

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

vi.mock("../src/utils/prisma.js", () => ({ prisma: {} }));
vi.mock("../src/utils/redis.js", () => ({ redis: { get: vi.fn(), setex: vi.fn() } }));
vi.mock("../src/services/notificationService.js", () => ({ enqueueEmail: vi.fn() }));

const { criarEscritorioETitular } = await import("../src/controllers/authController.js");
const { TERMS_VERSION } = await import("../src/legal/termsVersion.js");
const { CREDITOS_DE_CADASTRO } = await import("../src/utils/creditPolicy.js");

function fakeTx() {
  return {
    tenant: { create: vi.fn(async ({ data }) => ({ id: "tenant-1", ...data })) },
    user: { create: vi.fn(async ({ data }) => ({ id: "user-1", ...data })) },
    creditBalance: { create: vi.fn(async () => ({})) },
    creditTransaction: { create: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
}

const DADOS = {
  name: "Fulano de Tal",
  email: "fulano@gmail.com",
  passwordHash: "hash-bcrypt",
  cpfCnpj: "12345678901",
  oabNumber: "12345",
  oabState: "PI",
  termsVersion: TERMS_VERSION,
};

const req = { ip: "203.0.113.7", headers: { "user-agent": "vitest" } };

let tx;
beforeEach(() => {
  tx = fakeTx();
});

describe("criarEscritorioETitular", () => {
  it("cadastro por senha nasce sem e-mail verificado e sem Google", async () => {
    await criarEscritorioETitular(tx, DADOS, req);

    const { data } = tx.user.create.mock.calls[0][0];
    expect(data).toMatchObject({
      tenantId: "tenant-1",
      email: "fulano@gmail.com",
      passwordHash: "hash-bcrypt",
      role: "OWNER",
      emailVerified: false,
      googleSub: null,
      termsVersion: TERMS_VERSION,
    });
  });

  it("cadastro pelo Google nasce verificado e vinculado", async () => {
    await criarEscritorioETitular(tx, { ...DADOS, emailVerified: true, googleSub: "google-sub-1" }, req);

    const { data } = tx.user.create.mock.calls[0][0];
    expect(data.emailVerified).toBe(true);
    expect(data.googleSub).toBe("google-sub-1");
  });

  it("cria o escritório em TRIAL com os dados informados", async () => {
    await criarEscritorioETitular(tx, DADOS, req);

    expect(tx.tenant.create).toHaveBeenCalledWith({
      data: {
        name: "Fulano de Tal",
        cpfCnpj: "12345678901",
        oabNumber: "12345",
        oabState: "PI",
        status: "TRIAL",
      },
    });
  });

  it("credita os laudos de cadastro", async () => {
    await criarEscritorioETitular(tx, DADOS, req);

    expect(tx.creditBalance.create.mock.calls[0][0].data.creditsAvulso).toBe(CREDITOS_DE_CADASTRO);
    expect(tx.creditTransaction.create.mock.calls[0][0].data).toMatchObject({
      type: "EARN_AVULSO",
      amount: CREDITOS_DE_CADASTRO,
      userId: "user-1",
    });
  });

  it("registra o aceite dos termos com versão, IP e navegador", async () => {
    await criarEscritorioETitular(tx, DADOS, req);

    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "terms_accepted",
      userId: "user-1",
      ipAddress: "203.0.113.7",
      userAgent: "vitest",
      metadata: { version: TERMS_VERSION },
    });
  });

  it("devolve escritório e titular", async () => {
    const { tenant, user } = await criarEscritorioETitular(tx, DADOS, req);

    expect(tenant.id).toBe("tenant-1");
    expect(user.id).toBe("user-1");
  });
});
```

`backend/tests/concluirLogin.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Final comum a todo login que já provou a identidade, seja por senha, seja
 * pelo Google. O ponto que não pode regredir: com TOTP ativo NADA além do
 * desafio é emitido, nem cookie, nem token. Se o login com Google tivesse um
 * final próprio, bastaria ele esquecer esta regra para virar atalho que pula o
 * segundo fator.
 */

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

const user = { update: vi.fn() };
const auditLog = { create: vi.fn() };
const refreshToken = { create: vi.fn() };

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get user() {
      return user;
    },
    get auditLog() {
      return auditLog;
    },
    get refreshToken() {
      return refreshToken;
    },
  },
}));
vi.mock("../src/utils/redis.js", () => ({ redis: { get: vi.fn(), setex: vi.fn() } }));
vi.mock("../src/services/notificationService.js", () => ({ enqueueEmail: vi.fn() }));

const { concluirLogin, REFRESH_COOKIE } = await import("../src/controllers/authController.js");
const { verifyTotpChallenge, verifyAccessToken } = await import("../src/utils/jwt.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
      return this;
    },
  };
}

const req = { ip: "203.0.113.7", headers: { "user-agent": "vitest" } };

function conta(over = {}) {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    role: "OWNER",
    isPlatformAdmin: false,
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: [],
    tenant: { status: "ACTIVE" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  user.update.mockResolvedValue({});
  auditLog.create.mockResolvedValue({});
  refreshToken.create.mockResolvedValue({});
});

describe("concluirLogin", () => {
  it("emite sessão, atualiza o último login e audita a ação informada", async () => {
    const res = mockRes();

    await concluirLogin(req, res, conta(), { acao: "login_google" });

    expect(verifyAccessToken(res.body.accessToken).userId).toBe("user-1");
    expect(res.cookies[REFRESH_COOKIE]).toBeTruthy();
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "login_google",
      userId: "user-1",
      tenantId: "tenant-1",
      ipAddress: "203.0.113.7",
    });
  });

  it("audita como 'login' quando a ação não é informada", async () => {
    await concluirLogin(req, mockRes(), conta());

    expect(auditLog.create.mock.calls[0][0].data.action).toBe("login");
  });

  it("com TOTP ativo devolve só o desafio, sem cookie nem token", async () => {
    const res = mockRes();

    await concluirLogin(
      req,
      res,
      conta({ totpSecret: "ABCDEF", totpEnabledAt: new Date(), totpRecoveryCodes: ["hash-1"] })
    );

    expect(res.body.totpRequired).toBe(true);
    expect(verifyTotpChallenge(res.body.challenge).userId).toBe("user-1");
    expect(res.body.recuperacaoDisponivel).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.cookies).toEqual({});
    expect(refreshToken.create).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd backend && npx vitest run tests/criarEscritorioETitular.test.js tests/concluirLogin.test.js`
Expected: FAIL com `criarEscritorioETitular is not a function` e `concluirLogin is not a function`.

- [ ] **Step 3: Criar `backend/src/utils/cadastroSchema.js`**

```js
import { z } from "zod";
import { TERMS_VERSION } from "../legal/termsVersion.js";

/**
 * Campos do escritório exigidos em todo cadastro, seja por senha, seja pelo
 * Google. O Google entrega nome e e-mail, mas não CPF/CNPJ, OAB nem o aceite
 * dos termos, e sem eles o escritório não pode existir.
 *
 * Fica fora do `authController` porque testes substituem aquele módulo por um
 * mock de exportações fixas; um schema lido de lá no carregamento de outro
 * módulo quebraria esses testes.
 */
export const camposDoEscritorio = {
  name: z.string().min(3, "Nome muito curto"),
  cpfCnpj: z.string().min(11, "CPF/CNPJ inválido"),
  oabNumber: z.string().optional(),
  oabState: z.string().length(2).optional(),

  /*
   * Aceite dos documentos jurídicos, com a VERSÃO que o usuário viu.
   *
   * Exigir a versão, e não um booleano, é o que torna o aceite demonstrável:
   * documentos mudam, e sem ela qualquer cláusula invocada pode ser respondida
   * com "isso não estava lá quando eu me cadastrei".
   *
   * A validação recusa versão diferente da vigente. Isso cobre o caso do
   * formulário aberto numa aba antiga: se os termos mudaram entre o
   * carregamento da página e o envio, a pessoa aceitou um texto que não é mais
   * o atual, e registrar como se fosse seria falso.
   */
  termsVersion: z.literal(TERMS_VERSION, {
    error: "É necessário aceitar os Termos de Uso e a Política de Privacidade.",
  }),
};
```

- [ ] **Step 4: Usar `camposDoEscritorio` no `registerSchema`**

Em `backend/src/controllers/authController.js`, acrescentar o import junto dos demais:

```js
import { camposDoEscritorio } from "../utils/cadastroSchema.js";
```

E substituir o `registerSchema` inteiro (o bloco que vai de `const registerSchema = z.object({` até o `});` depois do `termsVersion`, incluindo o comentário longo sobre o aceite, que agora mora em `cadastroSchema.js`) por:

```js
const registerSchema = z.object({
  ...camposDoEscritorio,
  email: emailField(),
  password: z.string().min(1, "Senha é obrigatória"),
});
```

Depois disso `TERMS_VERSION` fica sem uso no `authController` (o único uso era o schema), mas `TERMS_LABEL` continua em uso no registro do aceite. Trocar o import por:

```js
import { TERMS_LABEL } from "../legal/termsVersion.js";
```

Conferir com `grep -n "TERMS_" backend/src/controllers/authController.js`: só `TERMS_LABEL` deve aparecer.

- [ ] **Step 5: Extrair `criarEscritorioETitular`**

Acrescentar em `authController.js`, logo antes de `export async function register(req, res) {`:

```js
/**
 * Cria escritório, titular, saldo de cadastro e o registro do aceite dos termos.
 *
 * Compartilhada entre o cadastro por senha e o cadastro pelo Google para que os
 * dois não possam divergir: mesmo bônus de laudos, mesmo registro de aceite. A
 * única diferença legítima vem em `dados`: quem chega pelo Google já provou o
 * e-mail (`emailVerified`) e traz o vínculo (`googleSub`).
 *
 * Recebe a transação em vez de abri-la porque o cadastro por senha grava, na
 * mesma transação, o token de verificação de e-mail.
 */
export async function criarEscritorioETitular(tx, dados, req) {
  const tenant = await tx.tenant.create({
    data: {
      name: dados.name, // Nome provisório do escritório
      cpfCnpj: dados.cpfCnpj,
      oabNumber: dados.oabNumber,
      oabState: dados.oabState,
      status: "TRIAL",
    },
  });

  const user = await tx.user.create({
    data: {
      tenantId: tenant.id,
      name: dados.name,
      email: dados.email,
      passwordHash: dados.passwordHash,
      role: "OWNER",
      oabNumber: dados.oabNumber,
      isPlatformAdmin: dados.email === process.env.PLATFORM_ADMIN_EMAIL,
      termsVersion: dados.termsVersion,
      termsAcceptedAt: new Date(),
      emailVerified: dados.emailVerified ?? false,
      googleSub: dados.googleSub ?? null,
    },
  });

  // Saldo Trial (CREDITOS_DE_CADASTRO laudos grátis)
  await tx.creditBalance.create({
    data: {
      tenantId: tenant.id,
      creditsMonthly: 0,
      creditsAvulso: CREDITOS_DE_CADASTRO,
    },
  });

  await tx.creditTransaction.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      type: "EARN_AVULSO",
      amount: CREDITOS_DE_CADASTRO,
      creditType: "avulso",
      source: "trial",
      notes: "Bônus de cadastro",
    },
  });

  /*
   * Registro do aceite na trilha de auditoria.
   *
   * O campo em `User` guarda o ESTADO (qual versão vale agora); o audit log
   * guarda o EVENTO, com data, hora, endereço IP e navegador. É o segundo
   * que sustenta a alegação em juízo, porque demonstra as circunstâncias do
   * aceite, e não apenas o seu resultado.
   *
   * Dentro da transação de propósito: um aceite registrado para um cadastro
   * que não completou seria pior que nenhum registro.
   */
  await tx.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      action: "terms_accepted",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { version: dados.termsVersion, documento: TERMS_LABEL },
    },
  });

  return { tenant, user };
}
```

E, dentro de `register`, substituir o bloco inteiro `const result = await prisma.$transaction(async (tx) => { ... return { user, tenant, verifyToken }; });` por:

```js
    // 3. Transação: escritório, titular, saldo, aceite e token de verificação
    const result = await prisma.$transaction(async (tx) => {
      const { user, tenant } = await criarEscritorioETitular(tx, { ...data, passwordHash }, req);

      // Criar token de verificação de e-mail
      const verifyToken = uuidv4();
      await tx.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(verifyToken),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        },
      });

      return { user, tenant, verifyToken };
    });
```

- [ ] **Step 6: Extrair `concluirLogin`**

Acrescentar em `authController.js`, logo antes de `export async function login(req, res) {`:

```js
/**
 * Final comum a todo login que já provou a identidade (senha ou Google).
 *
 * Existe para que o segundo fator não dependa de cada caminho de login lembrar
 * dele. Com um final por caminho, bastaria o novo esquecer o TOTP para virar
 * atalho que o pula.
 *
 * `acao` diferencia os caminhos na trilha de auditoria.
 */
export async function concluirLogin(req, res, user, { acao = "login" } = {}) {
  /*
   * Segundo fator: a identidade sozinha não abre sessão nenhuma.
   *
   * Nada é emitido aqui além do desafio, que é assinado com um segredo
   * derivado e não serve como token de acesso (ver utils/jwt.js). Emitir a
   * sessão agora e "exigir o TOTP depois" seria fingir um segundo fator: o
   * token já valeria para todo o resto da API.
   */
  if (totpAtivo(user)) {
    const challenge = generateTotpChallenge({ userId: user.id, typ: "totp" });
    return res.json({
      totpRequired: true,
      challenge,
      recuperacaoDisponivel: (user.totpRecoveryCodes || []).length > 0,
    });
  }

  const accessToken = await emitirSessao(res, user);

  // Atualizar último login e logar auditoria
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      action: acao,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });

  return res.json({ accessToken });
}
```

E, dentro de `login`, substituir tudo o que vem depois de `if (user.tenant.status === "SUSPENDED") return res.status(403)...;` até `return res.json({ accessToken });` (inclusive: o comentário do segundo fator, o `if (totpAtivo(user))`, o `emitirSessao`, o `update` e o `auditLog.create`) por:

```js
    return concluirLogin(req, res, user);
```

- [ ] **Step 7: Rodar os testes novos e a suíte inteira**

Run: `cd backend && npx vitest run tests/criarEscritorioETitular.test.js tests/concluirLogin.test.js`
Expected: PASS, 9 testes.

Run: `cd backend && npx vitest run`
Expected: tudo PASS. Em especial `termsAcceptance`, `accountLockout`, `authRefresh`, `adminMfa` e `totp`, que cobrem o login e o cadastro que foram mexidos.

- [ ] **Step 8: Commit**

```bash
/opt/homebrew/bin/git add backend/src/utils/cadastroSchema.js backend/src/controllers/authController.js backend/tests/criarEscritorioETitular.test.js backend/tests/concluirLogin.test.js
/opt/homebrew/bin/git commit -m "refactor(auth): extrai criação de escritório e final do login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/auth/google` (login e vínculo)

**Files:**
- Create: `backend/src/controllers/googleAuthController.js`
- Test: `backend/tests/googleLogin.test.js`

**Interfaces:**
- Consumes: `verificarCredencialGoogle`, `googleLoginHabilitado`, `CredencialGoogleInvalida` (Task 1); `generateGoogleSignupTicket` (Task 2); `concluirLogin` (Task 3).
- Produces: `googleLogin(req, res)`, com corpo `{ credential: string }` e respostas:
  - `200 { accessToken }` com cookie de refresh
  - `200 { totpRequired: true, challenge, recuperacaoDisponivel }`
  - `200 { cadastroPendente: true, ticket, email, name }`
  - `401 GOOGLE_TOKEN_INVALID`, `403 GOOGLE_EMAIL_NOT_VERIFIED`, `403 ACCOUNT_DEACTIVATED`, `403 ACCOUNT_SUSPENDED`, `404 GOOGLE_LOGIN_DISABLED`, `409 GOOGLE_ACCOUNT_MISMATCH`, `409 GOOGLE_EMAIL_PENDING_VERIFICATION`

- [ ] **Step 1: Escrever o teste que falha**

`backend/tests/googleLogin.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Login com Google: as decisões de vínculo.
 *
 * O que precisa ficar preso aqui, além do caminho feliz:
 *   - conta com e-mail AINDA NÃO CONFIRMADO não é vinculada (sequestro prévio:
 *     quem cadastrou aquele e-mail com senha pode não ser o dono);
 *   - e-mail já vinculado a outro `sub` não é revinculado em silêncio;
 *   - TOTP ativo continua exigindo o código;
 *   - sem conta, nada de sessão: só o ticket para completar o cadastro.
 */

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

const user = { findUnique: vi.fn(), update: vi.fn() };
const auditLog = { create: vi.fn() };
const refreshToken = { create: vi.fn() };

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get user() {
      return user;
    },
    get auditLog() {
      return auditLog;
    },
    get refreshToken() {
      return refreshToken;
    },
  },
}));
vi.mock("../src/utils/redis.js", () => ({ redis: { get: vi.fn(), setex: vi.fn() } }));
vi.mock("../src/services/notificationService.js", () => ({ enqueueEmail: vi.fn() }));

const verificarCredencialGoogle = vi.fn();
vi.mock("../src/services/googleIdentityService.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, verificarCredencialGoogle: (...args) => verificarCredencialGoogle(...args) };
});

const { googleLogin } = await import("../src/controllers/googleAuthController.js");
const { REFRESH_COOKIE } = await import("../src/controllers/authController.js");
const { verifyGoogleSignupTicket, verifyTotpChallenge } = await import("../src/utils/jwt.js");
const { CredencialGoogleInvalida } = await import("../src/services/googleIdentityService.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
      return this;
    },
  };
}

const req = () => ({
  body: { credential: "id-token" },
  ip: "203.0.113.7",
  headers: { "user-agent": "vitest" },
});

const IDENTIDADE = {
  sub: "google-sub-1",
  email: "fulano@gmail.com",
  emailVerified: true,
  name: "Fulano de Tal",
};

function conta(over = {}, tenant = {}) {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    email: "fulano@gmail.com",
    role: "OWNER",
    isPlatformAdmin: false,
    active: true,
    emailVerified: true,
    googleSub: "google-sub-1",
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: [],
    tenant: { status: "ACTIVE", ...tenant },
    ...over,
  };
}

/** Responde à busca por `googleSub` e à busca por e-mail de forma independente. */
function contas({ porSub = null, porEmail = null } = {}) {
  user.findUnique.mockImplementation(async ({ where }) => {
    if (where.googleSub) return porSub;
    if (where.email) return porEmail;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "cliente-teste.apps.googleusercontent.com";
  verificarCredencialGoogle.mockResolvedValue(IDENTIDADE);
  user.update.mockImplementation(async ({ data }) => ({ ...conta({ googleSub: null }), ...data }));
  auditLog.create.mockResolvedValue({});
  refreshToken.create.mockResolvedValue({});
  contas();
});

describe("POST /auth/google", () => {
  it("responde 404 quando o login com Google está desligado", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("GOOGLE_LOGIN_DISABLED");
    expect(verificarCredencialGoogle).not.toHaveBeenCalled();
  });

  it("recusa token inválido", async () => {
    verificarCredencialGoogle.mockRejectedValue(new CredencialGoogleInvalida("assinatura"));
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  it("recusa e-mail que o Google não confirmou", async () => {
    verificarCredencialGoogle.mockResolvedValue({ ...IDENTIDADE, emailVerified: false });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("GOOGLE_EMAIL_NOT_VERIFIED");
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it("abre sessão para conta já vinculada", async () => {
    contas({ porSub: conta() });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.cookies[REFRESH_COOKIE]).toBeTruthy();
    expect(auditLog.create.mock.calls.at(-1)[0].data.action).toBe("login_google");
  });

  it("exige o TOTP de quem o ativou", async () => {
    contas({ porSub: conta({ totpSecret: "ABCDEF", totpEnabledAt: new Date() }) });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.body.totpRequired).toBe(true);
    expect(verifyTotpChallenge(res.body.challenge).userId).toBe("user-1");
    expect(res.body.accessToken).toBeUndefined();
    expect(res.cookies).toEqual({});
  });

  it("vincula conta de e-mail confirmado no primeiro login", async () => {
    contas({ porEmail: conta({ googleSub: null }) });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { googleSub: "google-sub-1" },
      include: { tenant: true },
    });
    expect(auditLog.create.mock.calls[0][0].data.action).toBe("google_linked");
    expect(res.body.accessToken).toBeTruthy();
  });

  it("não vincula conta cujo e-mail ainda não foi confirmado", async () => {
    contas({ porEmail: conta({ googleSub: null, emailVerified: false }) });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("GOOGLE_EMAIL_PENDING_VERIFICATION");
    expect(user.update).not.toHaveBeenCalled();
    expect(res.cookies).toEqual({});
  });

  it("não revincula e-mail já ligado a outra conta Google", async () => {
    contas({ porEmail: conta({ googleSub: "outro-sub" }) });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("GOOGLE_ACCOUNT_MISMATCH");
    expect(user.update).not.toHaveBeenCalled();
  });

  it("sem conta, devolve o ticket de cadastro e nenhuma sessão", async () => {
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      cadastroPendente: true,
      email: "fulano@gmail.com",
      name: "Fulano de Tal",
    });
    expect(verifyGoogleSignupTicket(res.body.ticket)).toMatchObject({
      googleSub: "google-sub-1",
      email: "fulano@gmail.com",
    });
    expect(res.cookies).toEqual({});
    expect(res.body.accessToken).toBeUndefined();
  });

  it("recusa conta desativada", async () => {
    contas({ porSub: conta({ active: false }) });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DEACTIVATED");
  });

  it("recusa escritório suspenso", async () => {
    contas({ porSub: conta({}, { status: "SUSPENDED" }) });
    const res = mockRes();

    await googleLogin(req(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd backend && npx vitest run tests/googleLogin.test.js`
Expected: FAIL com `Failed to load url ../src/controllers/googleAuthController.js`.

- [ ] **Step 3: Implementar**

`backend/src/controllers/googleAuthController.js`:

```js
import { prisma } from "../utils/prisma.js";
import {
  verificarCredencialGoogle,
  googleLoginHabilitado,
  CredencialGoogleInvalida,
} from "../services/googleIdentityService.js";
import { generateGoogleSignupTicket } from "../utils/jwt.js";
import { concluirLogin } from "./authController.js";

/**
 * Login e cadastro com Google.
 *
 * O frontend recebe do Google Identity Services um ID token e o envia aqui. A
 * identidade é confirmada pelo Google; o que este controller decide é a qual
 * conta ela corresponde, e se pode corresponder a alguma.
 */

const DESLIGADO = { error: "Login com Google indisponível.", code: "GOOGLE_LOGIN_DISABLED" };

export async function googleLogin(req, res) {
  if (!googleLoginHabilitado()) return res.status(404).json(DESLIGADO);

  try {
    let identidade;
    try {
      identidade = await verificarCredencialGoogle(req.body?.credential);
    } catch (err) {
      if (err instanceof CredencialGoogleInvalida) {
        return res.status(401).json({
          error: "Não foi possível confirmar sua conta Google. Tente novamente.",
          code: "GOOGLE_TOKEN_INVALID",
        });
      }
      throw err;
    }

    // Sem a confirmação do Google, o e-mail do token é só um texto que alguém
    // digitou em algum lugar. Nada abaixo pode se apoiar nele.
    if (!identidade.emailVerified) {
      return res.status(403).json({
        error: "Sua conta Google não tem o e-mail confirmado. Confirme no Google ou entre com e-mail e senha.",
        code: "GOOGLE_EMAIL_NOT_VERIFIED",
      });
    }

    let user = await prisma.user.findUnique({
      where: { googleSub: identidade.sub },
      include: { tenant: true },
    });

    if (!user) {
      const porEmail = await prisma.user.findUnique({
        where: { email: identidade.email },
        include: { tenant: true },
      });

      if (porEmail?.googleSub) {
        /*
         * O e-mail é o mesmo, mas a conta Google é outra. Acontece quando uma
         * conta Workspace é apagada e recriada com o mesmo endereço. Revincular
         * em silêncio entregaria a conta daqui a uma identidade Google que nunca
         * foi vinculada a ela.
         */
        return res.status(409).json({
          error: "Este e-mail já está vinculado a outra conta Google. Entre com e-mail e senha.",
          code: "GOOGLE_ACCOUNT_MISMATCH",
        });
      }

      if (porEmail && !porEmail.emailVerified) {
        /*
         * Sequestro prévio de conta: qualquer um pode cadastrar, com senha, o
         * e-mail de outra pessoa, e a conta fica pendente porque ele não recebe
         * o link. Vincular aqui daria ao dono verdadeiro uma conta cuja senha e
         * cujo CPF/CNPJ foram escolhidos por outra pessoa. Só conta de e-mail
         * confirmado é vinculada.
         */
        return res.status(409).json({
          error:
            "Existe um cadastro com este e-mail aguardando confirmação. Use o link que enviamos no cadastro e depois entre com o Google.",
          code: "GOOGLE_EMAIL_PENDING_VERIFICATION",
        });
      }

      if (porEmail) {
        user = await prisma.user.update({
          where: { id: porEmail.id },
          data: { googleSub: identidade.sub },
          include: { tenant: true },
        });
        await prisma.auditLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            action: "google_linked",
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          },
        });
      }
    }

    if (!user) {
      // Identidade confirmada, mas sem conta. Nenhuma sessão aqui: o escritório
      // só existe depois de CPF/CNPJ e aceite dos termos, que o Google não dá.
      return res.json({
        cadastroPendente: true,
        ticket: generateGoogleSignupTicket({
          googleSub: identidade.sub,
          email: identidade.email,
          name: identidade.name,
        }),
        email: identidade.email,
        name: identidade.name,
      });
    }

    if (!user.active) return res.status(403).json({ error: "Conta desativada.", code: "ACCOUNT_DEACTIVATED" });
    if (user.tenant.status === "SUSPENDED") {
      return res.status(403).json({ error: "Conta suspensa.", code: "ACCOUNT_SUSPENDED" });
    }

    return concluirLogin(req, res, user, { acao: "login_google" });
  } catch (error) {
    console.error("[Auth] Erro no login com Google:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd backend && npx vitest run tests/googleLogin.test.js`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add backend/src/controllers/googleAuthController.js backend/tests/googleLogin.test.js
/opt/homebrew/bin/git commit -m "feat(auth): login com Google e vínculo por e-mail confirmado" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /api/auth/google/complete` (cadastro novo)

**Files:**
- Modify: `backend/src/controllers/googleAuthController.js`
- Test: `backend/tests/googleCompleteSignup.test.js`

**Interfaces:**
- Consumes: `verifyGoogleSignupTicket` (Task 2); `camposDoEscritorio`, `criarEscritorioETitular`, `concluirLogin` (Task 3).
- Produces: `googleCompleteSignup(req, res)`, com corpo `{ ticket, name, cpfCnpj, oabNumber?, oabState?, termsVersion }` e respostas `200 { accessToken }` (com cookie), `400` (validação ou `CPF/CNPJ já cadastrado.`), `401 GOOGLE_SIGNUP_EXPIRED`, `404 GOOGLE_LOGIN_DISABLED`, `409 GOOGLE_ACCOUNT_EXISTS`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/tests/googleCompleteSignup.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Conclusão do cadastro pelo Google.
 *
 * O ponto central: o e-mail da conta vem do TICKET, nunca do corpo. O ticket é
 * a prova de que o Google confirmou aquele endereço; um e-mail aceito do corpo
 * criaria conta já verificada para um endereço que ninguém provou possuir.
 */

process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

const tx = {
  tenant: { create: vi.fn(async ({ data }) => ({ id: "tenant-1", ...data })) },
  user: { create: vi.fn(async ({ data }) => ({ id: "user-1", ...data })) },
  creditBalance: { create: vi.fn(async () => ({})) },
  creditTransaction: { create: vi.fn(async () => ({})) },
  auditLog: { create: vi.fn(async () => ({})) },
};
const user = { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
const tenant = { findUnique: vi.fn() };
const auditLog = { create: vi.fn() };
const refreshToken = { create: vi.fn() };
const $transaction = vi.fn(async (fn) => fn(tx));

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    get user() {
      return user;
    },
    get tenant() {
      return tenant;
    },
    get auditLog() {
      return auditLog;
    },
    get refreshToken() {
      return refreshToken;
    },
    get $transaction() {
      return $transaction;
    },
  },
}));
vi.mock("../src/utils/redis.js", () => ({ redis: { get: vi.fn(), setex: vi.fn() } }));
vi.mock("../src/services/notificationService.js", () => ({ enqueueEmail: vi.fn() }));

const { googleCompleteSignup } = await import("../src/controllers/googleAuthController.js");
const { REFRESH_COOKIE } = await import("../src/controllers/authController.js");
const { generateGoogleSignupTicket } = await import("../src/utils/jwt.js");
const { TERMS_VERSION } = await import("../src/legal/termsVersion.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
      return this;
    },
  };
}

function corpo(over = {}) {
  return {
    ticket: generateGoogleSignupTicket({
      googleSub: "google-sub-1",
      email: "fulano@gmail.com",
      name: "Fulano",
    }),
    name: "Fulano de Tal",
    cpfCnpj: "12345678901",
    oabNumber: "",
    termsVersion: TERMS_VERSION,
    ...over,
  };
}

const req = (body) => ({ body, ip: "203.0.113.7", headers: { "user-agent": "vitest" } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "cliente-teste.apps.googleusercontent.com";
  user.findFirst.mockResolvedValue(null);
  tenant.findUnique.mockResolvedValue(null);
  user.findUnique.mockImplementation(async ({ where }) => ({
    id: where.id,
    tenantId: "tenant-1",
    role: "OWNER",
    isPlatformAdmin: false,
    active: true,
    emailVerified: true,
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: [],
    tenant: { status: "TRIAL" },
  }));
  user.update.mockResolvedValue({});
  auditLog.create.mockResolvedValue({});
  refreshToken.create.mockResolvedValue({});
});

describe("POST /auth/google/complete", () => {
  it("responde 404 quando o login com Google está desligado", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = mockRes();

    await googleCompleteSignup(req(corpo()), res);

    expect(res.statusCode).toBe(404);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("recusa ticket inválido ou vencido", async () => {
    const res = mockRes();

    await googleCompleteSignup(req(corpo({ ticket: "nao-e-um-ticket" })), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("GOOGLE_SIGNUP_EXPIRED");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("exige a versão vigente dos termos", async () => {
    const res = mockRes();

    await googleCompleteSignup(req(corpo({ termsVersion: "2020-01-01" })), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Termos de Uso/);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("recusa quando a conta já foi criada", async () => {
    user.findFirst.mockResolvedValue({ id: "user-antigo" });
    const res = mockRes();

    await googleCompleteSignup(req(corpo()), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("GOOGLE_ACCOUNT_EXISTS");
    expect(user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: "fulano@gmail.com" }, { googleSub: "google-sub-1" }] },
    });
  });

  it("recusa CPF/CNPJ já cadastrado", async () => {
    tenant.findUnique.mockResolvedValue({ id: "tenant-antigo" });
    const res = mockRes();

    await googleCompleteSignup(req(corpo()), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("CPF/CNPJ já cadastrado.");
    expect($transaction).not.toHaveBeenCalled();
  });

  it("cria conta verificada e vinculada, com o e-mail do ticket", async () => {
    const res = mockRes();

    await googleCompleteSignup(req(corpo({ email: "outra-pessoa@exemplo.com" })), res);

    const { data } = tx.user.create.mock.calls[0][0];
    expect(data.email).toBe("fulano@gmail.com");
    expect(data.emailVerified).toBe(true);
    expect(data.googleSub).toBe("google-sub-1");
    expect(data.name).toBe("Fulano de Tal");
    expect(data.termsVersion).toBe(TERMS_VERSION);
    // Senha que ninguém conhece: bcrypt de bytes aleatórios.
    expect(data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("abre sessão ao concluir", async () => {
    const res = mockRes();

    await googleCompleteSignup(req(corpo()), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.cookies[REFRESH_COOKIE]).toBeTruthy();
    expect(auditLog.create.mock.calls.at(-1)[0].data.action).toBe("login_google");
  });

  it("trata a corrida de dois envios simultâneos como conta existente", async () => {
    tx.user.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    const res = mockRes();

    await googleCompleteSignup(req(corpo()), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("GOOGLE_ACCOUNT_EXISTS");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd backend && npx vitest run tests/googleCompleteSignup.test.js`
Expected: FAIL com `googleCompleteSignup is not a function`.

- [ ] **Step 3: Implementar**

Em `backend/src/controllers/googleAuthController.js`, trocar os imports do topo por:

```js
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import {
  verificarCredencialGoogle,
  googleLoginHabilitado,
  CredencialGoogleInvalida,
} from "../services/googleIdentityService.js";
import { generateGoogleSignupTicket, verifyGoogleSignupTicket } from "../utils/jwt.js";
import { camposDoEscritorio } from "../utils/cadastroSchema.js";
import { concluirLogin, criarEscritorioETitular } from "./authController.js";
```

E acrescentar ao fim do arquivo:

```js
/**
 * O corpo traz só o que o Google não fornece. Não há campo `email`: o Zod
 * descarta chaves desconhecidas, então um e-mail mandado no corpo é ignorado e
 * o da conta sai do ticket.
 */
const completarSchema = z.object({
  ...camposDoEscritorio,
  ticket: z.string().min(1),
});

const CONTA_EXISTENTE = {
  error: "Já existe uma conta para este e-mail. Entre com o Google novamente.",
  code: "GOOGLE_ACCOUNT_EXISTS",
};

export async function googleCompleteSignup(req, res) {
  if (!googleLoginHabilitado()) return res.status(404).json(DESLIGADO);

  try {
    const data = completarSchema.parse(req.body);

    let ticket;
    try {
      ticket = verifyGoogleSignupTicket(data.ticket);
    } catch {
      return res.status(401).json({
        error: "O tempo para concluir o cadastro expirou. Entre com o Google novamente.",
        code: "GOOGLE_SIGNUP_EXPIRED",
      });
    }

    // O ticket vale por 20 minutos e pode ser reenviado nesse intervalo. A
    // segunda conclusão encontra a conta criada pela primeira e para aqui.
    const existente = await prisma.user.findFirst({
      where: { OR: [{ email: ticket.email }, { googleSub: ticket.googleSub }] },
    });
    if (existente) return res.status(409).json(CONTA_EXISTENTE);

    const tenantExistente = await prisma.tenant.findUnique({ where: { cpfCnpj: data.cpfCnpj } });
    if (tenantExistente) return res.status(400).json({ error: "CPF/CNPJ já cadastrado." });

    /*
     * Senha que ninguém conhece, em vez de `passwordHash` nulo. Com nulo, cada
     * leitura da coluna (login, troca de senha, painel) precisaria tratar o
     * caso. Assim o login por senha apenas falha com a mensagem genérica, e
     * quem quiser ter senha usa "Esqueci a senha", que prova posse do e-mail.
     */
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);

    const { user } = await prisma.$transaction((tx) =>
      criarEscritorioETitular(
        tx,
        {
          name: data.name,
          email: ticket.email,
          passwordHash,
          cpfCnpj: data.cpfCnpj,
          oabNumber: data.oabNumber,
          oabState: data.oabState,
          termsVersion: data.termsVersion,
          emailVerified: true,
          googleSub: ticket.googleSub,
        },
        req
      )
    );

    // `concluirLogin` precisa do tenant junto, que a criação não devolve.
    const completo = await prisma.user.findUnique({
      where: { id: user.id },
      include: { tenant: true },
    });
    return concluirLogin(req, res, completo, { acao: "login_google" });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0].message });
    // Dois envios simultâneos passam juntos pela checagem acima; o índice
    // único decide qual cria a conta, e o outro recebe a mesma resposta.
    if (error?.code === "P2002") return res.status(409).json(CONTA_EXISTENTE);
    console.error("[Auth] Erro ao concluir cadastro com Google:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd backend && npx vitest run tests/googleCompleteSignup.test.js tests/googleLogin.test.js`
Expected: PASS, 19 testes.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add backend/src/controllers/googleAuthController.js backend/tests/googleCompleteSignup.test.js
/opt/homebrew/bin/git commit -m "feat(auth): conclusão do cadastro pelo Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rotas, limitadores e variável de ambiente

**Files:**
- Modify: `backend/src/routes/authRoutes.js` (imports no topo; rotas públicas depois de `router.post("/reset-password", ...)`)
- Modify: `backend/.env.example` (depois do bloco `# ── Auth (JWT)`)
- Test: `backend/tests/googleRoutes.test.js`

**Interfaces:**
- Consumes: `googleLogin`, `googleCompleteSignup` (Tasks 4 e 5).
- Produces: `POST /api/auth/google` (limite `loginLimiter`: 10 por 15 min por IP) e `POST /api/auth/google/complete` (limite `registerLimiter`: 5 por hora por IP), ambas atrás do `csrfGuard`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/tests/googleRoutes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * As rotas do Google herdam as defesas das rotas de senha: a de login conta no
 * mesmo limitador do login (um ID token roubado não vale mais tentativas que
 * uma senha), a de conclusão no do cadastro (ela cria escritório e credita
 * laudos), e as duas passam pela validação de origem.
 */

const contadores = new Map();

vi.mock("../src/utils/redis.js", () => ({
  redis: { call: vi.fn(async () => 0), get: vi.fn(), setex: vi.fn() },
}));

vi.mock("rate-limit-redis", () => ({
  RedisStore: class {
    constructor({ prefix }) {
      this.prefix = prefix;
    }
    async increment(key) {
      const k = `${this.prefix}${key}`;
      const atual = (contadores.get(k) || 0) + 1;
      contadores.set(k, atual);
      return { totalHits: atual, resetTime: new Date(Date.now() + 60_000) };
    }
    async decrement(key) {
      const k = `${this.prefix}${key}`;
      contadores.set(k, Math.max(0, (contadores.get(k) || 0) - 1));
    }
    async resetKey(key) {
      contadores.delete(`${this.prefix}${key}`);
    }
  },
}));

const googleLogin = vi.fn((_req, res) => res.status(200).json({ ok: true }));
const googleCompleteSignup = vi.fn((_req, res) => res.status(200).json({ ok: true }));
vi.mock("../src/controllers/googleAuthController.js", () => ({
  googleLogin: (req, res) => googleLogin(req, res),
  googleCompleteSignup: (req, res) => googleCompleteSignup(req, res),
}));

vi.mock("../src/middleware/auth.js", () => ({
  requireAuth: (_req, _res, next) => next(),
}));

const authRoutes = (await import("../src/routes/authRoutes.js")).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

beforeEach(() => {
  contadores.clear();
  vi.clearAllMocks();
});

describe("rotas do login com Google", () => {
  it("POST /google chega ao controller", async () => {
    const r = await request(makeApp()).post("/api/auth/google").send({ credential: "x" });

    expect(r.status).toBe(200);
    expect(googleLogin).toHaveBeenCalledTimes(1);
  });

  it("POST /google usa o limite do login (10 por janela)", async () => {
    const app = makeApp();
    const status = [];
    for (let i = 0; i < 11; i++) {
      status.push((await request(app).post("/api/auth/google").send({ credential: "x" })).status);
    }

    expect(status.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(status[10]).toBe(429);
  });

  it("POST /google/complete usa o limite do cadastro (5 por janela)", async () => {
    const app = makeApp();
    const status = [];
    for (let i = 0; i < 6; i++) {
      status.push((await request(app).post("/api/auth/google/complete").send({ ticket: "x" })).status);
    }

    expect(status.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(status[5]).toBe(429);
  });

  it("recusa origem de outro site", async () => {
    const r = await request(makeApp())
      .post("/api/auth/google")
      .set("Origin", "https://site-malicioso.example")
      .send({ credential: "x" });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe("CSRF_ORIGIN_REJECTED");
    expect(googleLogin).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd backend && npx vitest run tests/googleRoutes.test.js`
Expected: FAIL, as requisições respondem 404 e `googleLogin` não é chamado.

- [ ] **Step 3: Registrar as rotas**

Em `backend/src/routes/authRoutes.js`, depois do import de `totpController`:

```js
import { googleLogin, googleCompleteSignup } from "../controllers/googleAuthController.js";
```

E depois da linha `router.post("/reset-password", tokenLimiter, resetPassword);`:

```js

/**
 * Login com Google.
 *
 * O limite por IP é o do login: um ID token não vale mais tentativas que uma
 * senha. O bloqueio por conta não se aplica, porque o corpo não traz e-mail
 * (a chave seria a mesma para todos) e um token do Google não se adivinha por
 * força bruta. A conclusão do cadastro cria escritório e credita laudos, então
 * usa o limite do cadastro.
 */
router.post("/google", loginLimiter, googleLogin);
router.post("/google/complete", registerLimiter, googleCompleteSignup);
```

- [ ] **Step 4: Documentar a variável**

Em `backend/.env.example`, logo depois da linha `JWT_ACCESS_EXPIRES=15m` e do comentário que a segue (o bloco que termina em `# rotacionar onde não há.`), acrescentar:

```bash

# ── Login com Google ──────────────────────────────────
# Client ID do tipo "Aplicativo da Web" criado no Google Cloud Console
# (APIs e serviços > Credenciais). É o MESMO valor de VITE_GOOGLE_CLIENT_ID no
# frontend: o backend só aceita ID token emitido para este client.
# Não existe client secret neste fluxo.
# Vazio = login com Google desligado (as rotas respondem 404).
GOOGLE_CLIENT_ID=
```

- [ ] **Step 5: Rodar o teste e a suíte inteira**

Run: `cd backend && npx vitest run tests/googleRoutes.test.js`
Expected: PASS, 4 testes.

Run: `cd backend && npx vitest run`
Expected: tudo PASS, inclusive `accountLockout.test.js`, que importa o `authRoutes` real.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add backend/src/routes/authRoutes.js backend/.env.example backend/tests/googleRoutes.test.js
/opt/homebrew/bin/git commit -m "feat(auth): rotas do login com Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Componente `GoogleButton`

**Files:**
- Create: `frontend/src/components/GoogleButton.jsx`
- Modify: `frontend/.env.example`
- Test: `frontend/src/tests/googleButton.test.jsx`

**Interfaces:**
- Produces:
  - `export default function GoogleButton({ onCredential: (credential: string) => void, texto?: "signin_with" | "signup_with" })`, que renderiza `null` sem `VITE_GOOGLE_CLIENT_ID`.
  - `export function googleLoginDisponivel(): boolean`

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/tests/googleButton.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import GoogleButton, { googleLoginDisponivel } from "../components/GoogleButton.jsx";

/**
 * O botão é o oficial do Google, desenhado por ele dentro de um iframe. O que
 * cabe testar aqui é a nossa parte: sem client ID nada aparece (e o login por
 * senha segue intacto), e com client ID a credencial devolvida pelo Google
 * chega a quem usa o componente.
 */

const CLIENT_ID = "cliente-teste.apps.googleusercontent.com";

function stubGoogle() {
  const id = { initialize: vi.fn(), renderButton: vi.fn() };
  window.google = { accounts: { id } };
  return id;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
});

describe("GoogleButton", () => {
  it("não renderiza nada sem client ID", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");

    const { container } = render(<GoogleButton onCredential={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(googleLoginDisponivel()).toBe(false);
  });

  it("inicializa com o client ID e entrega a credencial", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", CLIENT_ID);
    const id = stubGoogle();
    const onCredential = vi.fn();

    render(<GoogleButton onCredential={onCredential} texto="signup_with" />);

    await vi.waitFor(() => expect(id.renderButton).toHaveBeenCalled());
    const config = id.initialize.mock.calls[0][0];
    expect(config.client_id).toBe(CLIENT_ID);
    expect(id.renderButton.mock.calls[0][1]).toMatchObject({ text: "signup_with" });

    config.callback({ credential: "id-token-1" });
    expect(onCredential).toHaveBeenCalledWith("id-token-1");
    expect(screen.getByTestId("google-button")).toBeInTheDocument();
    expect(googleLoginDisponivel()).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd frontend && npx vitest run src/tests/googleButton.test.jsx`
Expected: FAIL com `Failed to resolve import "../components/GoogleButton.jsx"`.

- [ ] **Step 3: Implementar**

`frontend/src/components/GoogleButton.jsx`:

```jsx
import { useEffect, useRef } from "react";

/**
 * Botão "Entrar com Google" (Google Identity Services).
 *
 * O botão é desenhado pelo próprio Google dentro de um iframe, e não por nós:
 * é o que as diretrizes de marca do Google exigem e o que faz o usuário
 * reconhecer a tela como legítima. Em modo popup, o Google devolve o ID token
 * direto para o `callback`, sem redirecionar a página, então o formulário de
 * senha continua onde estava.
 *
 * O script é carregado sob demanda, só nas telas que mostram o botão.
 */

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// Lido na hora do uso, e não no carregamento do módulo, para que os testes
// possam ligar e desligar a variável.
function clientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID;
}

export function googleLoginDisponivel() {
  return Boolean(clientId());
}

let carregamento;
function carregarScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  carregamento ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => {
      // Libera nova tentativa na próxima montagem (rede instável, bloqueador).
      carregamento = undefined;
      reject(new Error("Falha ao carregar o Google Identity Services."));
    };
    document.head.appendChild(script);
  });
  return carregamento;
}

export default function GoogleButton({ onCredential, texto = "signin_with" }) {
  const alvo = useRef(null);
  // O Google guarda o callback da primeira inicialização. A ref faz ele sempre
  // chamar a versão atual do handler, sem reinicializar a cada render.
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    const id = clientId();
    if (!id) return undefined;

    let montado = true;
    carregarScript()
      .then(() => {
        if (!montado || !alvo.current) return;
        window.google.accounts.id.initialize({
          client_id: id,
          callback: (resposta) => callbackRef.current(resposta.credential),
          ux_mode: "popup",
        });
        window.google.accounts.id.renderButton(alvo.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: texto,
          width: 320,
          locale: "pt-BR",
        });
      })
      // Sem o script, o botão simplesmente não aparece; o login por senha
      // continua disponível na mesma tela.
      .catch(() => {});

    return () => {
      montado = false;
    };
  }, [texto]);

  if (!clientId()) return null;
  return <div ref={alvo} data-testid="google-button" className="flex justify-center min-h-[44px]" />;
}
```

- [ ] **Step 4: Documentar a variável**

Em `frontend/.env.example`, depois da linha `VITE_API_BASE=`:

```bash

# Client ID do Google (Google Cloud Console > APIs e serviços > Credenciais),
# o mesmo valor de GOOGLE_CLIENT_ID no backend. Entra no bundle no momento do
# build, então mudar exige novo `npm run build`.
# Vazio = botão "Entrar com Google" não aparece.
VITE_GOOGLE_CLIENT_ID=
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd frontend && npx vitest run src/tests/googleButton.test.jsx`
Expected: PASS, 2 testes.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/components/GoogleButton.jsx frontend/.env.example frontend/src/tests/googleButton.test.jsx
/opt/homebrew/bin/git commit -m "feat(frontend): botão Entrar com Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Store e hook do login com Google

**Files:**
- Modify: `frontend/src/store/authStore.js` (depois de `verifyTotp`)
- Create: `frontend/src/hooks/useEntrarComGoogle.js`
- Test: `frontend/src/tests/authStoreGoogle.test.js`, `frontend/src/tests/useEntrarComGoogle.test.jsx`

**Interfaces:**
- Consumes: `POST /api/auth/google` e `POST /api/auth/google/complete` (Tasks 4 a 6).
- Produces:
  - `useAuthStore().loginGoogle(credential)` resolve para um de: `{ success: true }`, `{ success: false, totpRequired: true, challenge, recuperacaoDisponivel }`, `{ success: false, cadastroPendente: true, ticket, email, name }`, `{ success: false, error }`.
  - `useAuthStore().completarCadastroGoogle({ ticket, name, cpfCnpj, oabNumber, termsVersion })` resolve para `{ success: true }` ou `{ success: false, expirado: boolean, error }`.
  - `destinoAposLogin(): "/dashboard" | "/onboarding"`
  - `useEntrarComGoogle({ aoPedirTotp: (resultado) => void }): (credential: string) => Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/tests/authStoreGoogle.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A store traduz as respostas do servidor em quatro desfechos para a tela. O
 * que não pode acontecer: guardar token quando o servidor pediu TOTP ou
 * cadastro, porque aí a tela mostraria o próximo passo com uma sessão já
 * aberta por trás.
 */

const post = vi.fn();
const get = vi.fn();
const setAccessToken = vi.fn();

vi.mock("../lib/axios", () => ({
  api: { post: (...a) => post(...a), get: (...a) => get(...a) },
  setAccessToken: (...a) => setAccessToken(...a),
  clearAccessToken: vi.fn(),
  getAccessToken: () => "token-em-memoria",
  bootstrapAuth: vi.fn(),
}));

const { useAuthStore } = await import("../store/authStore");

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url) =>
    url === "/auth/me" ? { data: { user: { id: "u1" } } } : { data: { balance: null } }
  );
});

describe("loginGoogle", () => {
  it("abre sessão quando o servidor devolve token", async () => {
    post.mockResolvedValue({ data: { accessToken: "tok-1" } });

    const r = await useAuthStore.getState().loginGoogle("id-token");

    expect(post).toHaveBeenCalledWith("/auth/google", { credential: "id-token" });
    expect(r).toEqual({ success: true });
    expect(setAccessToken).toHaveBeenCalledWith("tok-1");
    expect(useAuthStore.getState().user).toEqual({ id: "u1" });
  });

  it("repassa o desafio TOTP sem guardar token", async () => {
    post.mockResolvedValue({
      data: { totpRequired: true, challenge: "ch-1", recuperacaoDisponivel: true },
    });

    const r = await useAuthStore.getState().loginGoogle("id-token");

    expect(r).toEqual({
      success: false,
      totpRequired: true,
      challenge: "ch-1",
      recuperacaoDisponivel: true,
    });
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it("repassa o cadastro pendente sem guardar token", async () => {
    post.mockResolvedValue({
      data: { cadastroPendente: true, ticket: "t-1", email: "fulano@gmail.com", name: "Fulano" },
    });

    const r = await useAuthStore.getState().loginGoogle("id-token");

    expect(r).toEqual({
      success: false,
      cadastroPendente: true,
      ticket: "t-1",
      email: "fulano@gmail.com",
      name: "Fulano",
    });
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it("devolve a mensagem do servidor quando falha", async () => {
    post.mockRejectedValue({ response: { data: { error: "Este e-mail já está vinculado a outra conta Google." } } });

    const r = await useAuthStore.getState().loginGoogle("id-token");

    expect(r).toEqual({ success: false, error: "Este e-mail já está vinculado a outra conta Google." });
  });
});

describe("completarCadastroGoogle", () => {
  it("abre sessão ao concluir", async () => {
    post.mockResolvedValue({ data: { accessToken: "tok-2" } });

    const r = await useAuthStore.getState().completarCadastroGoogle({ ticket: "t-1" });

    expect(post).toHaveBeenCalledWith("/auth/google/complete", { ticket: "t-1" });
    expect(r).toEqual({ success: true });
    expect(setAccessToken).toHaveBeenCalledWith("tok-2");
  });

  it.each(["GOOGLE_SIGNUP_EXPIRED", "GOOGLE_ACCOUNT_EXISTS"])(
    "marca como expirado quando o servidor responde %s",
    async (code) => {
      post.mockRejectedValue({ response: { data: { error: "msg", code } } });

      const r = await useAuthStore.getState().completarCadastroGoogle({ ticket: "t-1" });

      expect(r).toEqual({ success: false, expirado: true, error: "msg" });
    }
  );

  it("erro de validação não é expiração", async () => {
    post.mockRejectedValue({ response: { data: { error: "CPF/CNPJ já cadastrado." } } });

    const r = await useAuthStore.getState().completarCadastroGoogle({ ticket: "t-1" });

    expect(r).toEqual({ success: false, expirado: false, error: "CPF/CNPJ já cadastrado." });
  });
});
```

`frontend/src/tests/useEntrarComGoogle.test.jsx`:

```jsx
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * O hook concentra o que fazer com cada desfecho do login com Google, para que
 * a tela de login e a de cadastro reajam igual. A única diferença entre elas é
 * onde mostrar o passo do TOTP, e é isso que `aoPedirTotp` deixa a tela decidir.
 */

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual("react-router-dom");
  return { ...real, useNavigate: () => navigate };
});

const loginGoogle = vi.fn();
const estado = { user: { id: "u1" }, loginGoogle };
vi.mock("../store/authStore", () => ({
  useAuthStore: Object.assign((seletor) => seletor(estado), { getState: () => estado }),
}));

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, __esModule: true };
});

const { useEntrarComGoogle, destinoAposLogin } = await import("../hooks/useEntrarComGoogle");
const { default: toast } = await import("react-hot-toast");

function montar(aoPedirTotp = vi.fn()) {
  const { result } = renderHook(() => useEntrarComGoogle({ aoPedirTotp }));
  return result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("destinoAposLogin", () => {
  it("manda para o onboarding quem ainda não o viu", () => {
    expect(destinoAposLogin()).toBe("/onboarding");
  });

  it("manda para o painel quem já viu o onboarding", () => {
    localStorage.setItem("onboarding_seen_u1", "1");
    expect(destinoAposLogin()).toBe("/dashboard");
  });
});

describe("useEntrarComGoogle", () => {
  it("navega para o destino após login", async () => {
    loginGoogle.mockResolvedValue({ success: true });

    await montar()("id-token");

    expect(loginGoogle).toHaveBeenCalledWith("id-token");
    expect(toast.success).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/onboarding");
  });

  it("entrega o desafio TOTP para a tela decidir onde mostrar", async () => {
    const resultado = { success: false, totpRequired: true, challenge: "ch-1", recuperacaoDisponivel: false };
    loginGoogle.mockResolvedValue(resultado);
    const aoPedirTotp = vi.fn();

    await montar(aoPedirTotp)("id-token");

    expect(aoPedirTotp).toHaveBeenCalledWith(resultado);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leva o cadastro pendente para a tela de completar", async () => {
    loginGoogle.mockResolvedValue({
      success: false,
      cadastroPendente: true,
      ticket: "t-1",
      email: "fulano@gmail.com",
      name: "Fulano",
    });

    await montar()("id-token");

    expect(navigate).toHaveBeenCalledWith("/cadastro-google", {
      state: { ticket: "t-1", email: "fulano@gmail.com", name: "Fulano" },
    });
  });

  it("mostra o erro do servidor", async () => {
    loginGoogle.mockResolvedValue({ success: false, error: "Falhou." });

    await montar()("id-token");

    expect(toast.error).toHaveBeenCalledWith("Falhou.");
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd frontend && npx vitest run src/tests/authStoreGoogle.test.js src/tests/useEntrarComGoogle.test.jsx`
Expected: FAIL com `loginGoogle is not a function` e `Failed to resolve import "../hooks/useEntrarComGoogle"`.

- [ ] **Step 3: Acrescentar as ações na store**

Em `frontend/src/store/authStore.js`, logo depois do fechamento de `verifyTotp: async (challenge, codigo) => { ... },`:

```js
  /**
   * Login com Google. Além de sessão e erro, o servidor pode pedir o TOTP (o
   * mesmo desafio do login por senha, verificado por `verifyTotp`) ou o
   * complemento do cadastro, quando o Google confirmou um e-mail sem conta.
   * Nos dois últimos casos nenhum token é guardado.
   */
  loginGoogle: async (credential) => {
    try {
      const response = await api.post("/auth/google", { credential });

      if (response.data.totpRequired) {
        return {
          success: false,
          totpRequired: true,
          challenge: response.data.challenge,
          recuperacaoDisponivel: response.data.recuperacaoDisponivel,
        };
      }

      if (response.data.cadastroPendente) {
        return {
          success: false,
          cadastroPendente: true,
          ticket: response.data.ticket,
          email: response.data.email,
          name: response.data.name,
        };
      }

      setAccessToken(response.data.accessToken);
      await useAuthStore.getState().checkAuth();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || "Não foi possível entrar com o Google.",
      };
    }
  },

  completarCadastroGoogle: async (dados) => {
    try {
      const response = await api.post("/auth/google/complete", dados);
      setAccessToken(response.data.accessToken);
      await useAuthStore.getState().checkAuth();
      return { success: true };
    } catch (error) {
      const code = error.response?.data?.code;
      return {
        success: false,
        // Ticket vencido ou conta já criada: insistir nesta tela não resolve,
        // o caminho é entrar com o Google de novo.
        expirado: code === "GOOGLE_SIGNUP_EXPIRED" || code === "GOOGLE_ACCOUNT_EXISTS",
        error: error.response?.data?.error || "Não foi possível concluir o cadastro.",
      };
    }
  },
```

- [ ] **Step 4: Criar o hook**

`frontend/src/hooks/useEntrarComGoogle.js`:

```js
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuthStore } from "../store/authStore";

/**
 * Para onde ir depois de entrar. Estava dentro da tela de login; saiu daqui
 * porque o login com Google e a conclusão do cadastro precisam da mesma regra.
 */
export function destinoAposLogin() {
  const user = useAuthStore.getState().user;
  const seenOnboarding = user && localStorage.getItem(`onboarding_seen_${user.id}`);
  return seenOnboarding ? "/dashboard" : "/onboarding";
}

/**
 * Trata os quatro desfechos do login com Google.
 *
 * O login e o cadastro usam o mesmo botão e precisam reagir igual. A diferença
 * é onde mostrar o passo do TOTP: o login o mostra na própria tela, o cadastro
 * leva o desafio até o login. Por isso `aoPedirTotp` fica com a tela.
 */
export function useEntrarComGoogle({ aoPedirTotp }) {
  const navigate = useNavigate();
  const loginGoogle = useAuthStore((state) => state.loginGoogle);

  return async (credential) => {
    const result = await loginGoogle(credential);

    if (result.success) {
      toast.success("Login realizado com sucesso!");
      return navigate(destinoAposLogin());
    }

    if (result.totpRequired) return aoPedirTotp(result);

    if (result.cadastroPendente) {
      return navigate("/cadastro-google", {
        state: { ticket: result.ticket, email: result.email, name: result.name },
      });
    }

    toast.error(result.error);
  };
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `cd frontend && npx vitest run src/tests/authStoreGoogle.test.js src/tests/useEntrarComGoogle.test.jsx`
Expected: PASS, 15 testes.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/store/authStore.js frontend/src/hooks/useEntrarComGoogle.js frontend/src/tests/authStoreGoogle.test.js frontend/src/tests/useEntrarComGoogle.test.jsx
/opt/homebrew/bin/git commit -m "feat(frontend): store e hook do login com Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Botão do Google na tela de login

**Files:**
- Modify: `frontend/src/pages/Login.jsx`
- Test: `frontend/src/tests/loginGoogle.test.jsx`

**Interfaces:**
- Consumes: `GoogleButton`, `googleLoginDisponivel` (Task 7); `useEntrarComGoogle`, `destinoAposLogin` (Task 8).
- Produces: `/login` aceita `location.state = { challenge, recuperacaoDisponivel }` e, nesse caso, abre direto no passo do código. É por aí que o cadastro (Task 10) entrega o desafio TOTP.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/tests/loginGoogle.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Integração do login com Google na tela de login. Os desfechos em si estão
 * cobertos no teste do hook; aqui o que importa é a tela: o TOTP pedido depois
 * do Google aparece no mesmo passo de código do login por senha, e um desafio
 * trazido de outra tela (o cadastro) abre direto nesse passo.
 */

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual("react-router-dom");
  return { ...real, useNavigate: () => navigate };
});

const loginGoogle = vi.fn();
const estado = { user: { id: "u1" }, login: vi.fn(), verifyTotp: vi.fn(), loginGoogle };
vi.mock("../store/authStore", () => ({
  useAuthStore: Object.assign((seletor) => seletor(estado), { getState: () => estado }),
}));

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, __esModule: true };
});

// O botão real vive num iframe do Google. Este dublê entrega uma credencial
// fixa ao ser clicado, que é tudo o que a tela recebe do Google de verdade.
vi.mock("../components/GoogleButton.jsx", () => ({
  default: ({ onCredential }) => (
    <button type="button" onClick={() => onCredential("id-token-1")}>
      Google
    </button>
  ),
  googleLoginDisponivel: () => true,
}));

const { default: Login } = await import("../pages/Login.jsx");

function renderizar(entrada = "/login") {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Login />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Login com Google", () => {
  it("mostra o botão e a separação do formulário de senha", () => {
    renderizar();

    expect(screen.getByRole("button", { name: "Google" })).toBeInTheDocument();
    expect(screen.getByText(/ou com e-mail e senha/i)).toBeInTheDocument();
  });

  it("entra direto quando o servidor devolve sessão", async () => {
    loginGoogle.mockResolvedValue({ success: true });
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding"));
  });

  it("pede o código na mesma tela quando a conta tem TOTP", async () => {
    loginGoogle.mockResolvedValue({ success: false, totpRequired: true, challenge: "ch-1" });
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    expect(await screen.findByText(/verificação em duas etapas/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google" })).not.toBeInTheDocument();
  });

  it("abre no passo do código quando chega com desafio", () => {
    renderizar({ pathname: "/login", state: { challenge: "ch-9", recuperacaoDisponivel: true } });

    expect(screen.getByText(/verificação em duas etapas/i)).toBeInTheDocument();
    expect(screen.getByText(/códigos de recuperação/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd frontend && npx vitest run src/tests/loginGoogle.test.jsx`
Expected: FAIL, `Unable to find an accessible element with the role "button" and name "Google"`.

- [ ] **Step 3: Alterar `frontend/src/pages/Login.jsx`**

Imports: trocar

```jsx
import { Link, useNavigate } from "react-router-dom";
```

por

```jsx
import { Link, useLocation, useNavigate } from "react-router-dom";
```

e acrescentar, depois do import de `useAuthStore`:

```jsx
import GoogleButton, { googleLoginDisponivel } from "../components/GoogleButton.jsx";
import { useEntrarComGoogle, destinoAposLogin } from "../hooks/useEntrarComGoogle";
```

Estado inicial do passo do código: trocar

```jsx
  const [challenge, setChallenge] = useState("");
  const [recuperacaoDisponivel, setRecuperacaoDisponivel] = useState(false);
```

por

```jsx
  // O desafio pode chegar pronto de outra tela: quem entra com Google pela
  // tela de cadastro e tem TOTP ativo é trazido para cá já no passo do código.
  const location = useLocation();
  const [challenge, setChallenge] = useState(location.state?.challenge || "");
  const [recuperacaoDisponivel, setRecuperacaoDisponivel] = useState(
    Boolean(location.state?.recuperacaoDisponivel)
  );
```

Trocar a função `concluir` inteira por:

```jsx
  const concluir = () => {
    toast.success("Login realizado com sucesso!");
    navigate(destinoAposLogin());
  };

  const pedirTotp = (result) => {
    setChallenge(result.challenge);
    setRecuperacaoDisponivel(Boolean(result.recuperacaoDisponivel));
  };

  const entrarComGoogle = useEntrarComGoogle({ aoPedirTotp: pedirTotp });
```

Em `handleSubmit`, trocar

```jsx
    if (result.totpRequired) {
      setChallenge(result.challenge);
      setRecuperacaoDisponivel(Boolean(result.recuperacaoDisponivel));
      return;
    }
```

por

```jsx
    if (result.totpRequired) return pedirTotp(result);
```

No JSX, o ramo do passo da senha começa em `) : (` seguido de `<form className="space-y-6" onSubmit={handleSubmit}>` e termina em `</form>` seguido de `)}`. Envolver esse ramo num fragmento com o bloco do Google antes do formulário. Trocar

```jsx
          ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
```

por

```jsx
          ) : (
          <>
          {googleLoginDisponivel() && (
            <div className="mb-6 space-y-6">
              <GoogleButton onCredential={entrarComGoogle} texto="signin_with" />
              <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500">
                <span className="h-px flex-1 bg-surface-border" />
                ou com e-mail e senha
                <span className="h-px flex-1 bg-surface-border" />
              </div>
            </div>
          )}
          <form className="space-y-6" onSubmit={handleSubmit}>
```

e trocar o fechamento

```jsx
          </form>
          )}
        </div>
```

por

```jsx
          </form>
          </>
          )}
        </div>
```

- [ ] **Step 4: Rodar os testes da tela de login**

Run: `cd frontend && npx vitest run src/tests/loginGoogle.test.jsx src/tests/loginTotp.test.jsx`
Expected: PASS nos dois arquivos. O `loginTotp` continua passando porque, sem `VITE_GOOGLE_CLIENT_ID`, o botão do Google não aparece e o botão "Entrar" é o único que casa com `/entrar/i`.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/pages/Login.jsx frontend/src/tests/loginGoogle.test.jsx
/opt/homebrew/bin/git commit -m "feat(frontend): Entrar com Google na tela de login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tela de completar cadastro e botão no cadastro

**Files:**
- Create: `frontend/src/components/AceiteTermos.jsx`
- Create: `frontend/src/pages/CadastroGoogle.jsx`
- Modify: `frontend/src/pages/Register.jsx`
- Modify: `frontend/src/App.jsx` (import junto de `Register`; rota depois de `/register`)
- Test: `frontend/src/tests/cadastroGoogle.test.jsx`

**Interfaces:**
- Consumes: `completarCadastroGoogle` (Task 8); `destinoAposLogin`, `useEntrarComGoogle` (Task 8); `GoogleButton`, `googleLoginDisponivel` (Task 7); `TERMS_VERSION` de `frontend/src/utils/legalVersion.js`.
- Produces: rota `/cadastro-google`, que espera `location.state = { ticket, email, name }`; componente `AceiteTermos({ checked: boolean, onChange: (marcado: boolean) => void })`.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/tests/cadastroGoogle.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TERMS_VERSION } from "../utils/legalVersion";

/**
 * Complemento do cadastro pelo Google.
 *
 * A tela só existe com o ticket: aberta direto pela URL, volta para o login.
 * O envio precisa levar a VERSÃO dos termos (é ela que torna o aceite
 * demonstrável) e o CPF/CNPJ só com dígitos, como o cadastro por senha faz. O
 * e-mail não vai no corpo: o servidor o tira do ticket.
 */

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual("react-router-dom");
  return { ...real, useNavigate: () => navigate };
});

const completarCadastroGoogle = vi.fn();
const estado = { user: { id: "u1" }, completarCadastroGoogle };
vi.mock("../store/authStore", () => ({
  useAuthStore: Object.assign((seletor) => seletor(estado), { getState: () => estado }),
}));

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, __esModule: true };
});

const { default: CadastroGoogle } = await import("../pages/CadastroGoogle.jsx");
const { default: toast } = await import("react-hot-toast");

const PENDENTE = { ticket: "t-1", email: "fulano@gmail.com", name: "Fulano de Tal" };

function renderizar(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/cadastro-google", state }]}>
      <Routes>
        <Route path="/cadastro-google" element={<CadastroGoogle />} />
        <Route path="/login" element={<p>tela de login</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function preencherEAceitar() {
  fireEvent.change(screen.getByLabelText(/cpf ou cnpj/i), { target: { value: "123.456.789-01" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("CadastroGoogle", () => {
  it("volta para o login quando aberta sem ticket", () => {
    renderizar(undefined);

    expect(screen.getByText("tela de login")).toBeInTheDocument();
  });

  it("mostra o e-mail confirmado e o nome vindo do Google", () => {
    renderizar(PENDENTE);

    expect(screen.getByText("fulano@gmail.com")).toBeInTheDocument();
    expect(screen.getByLabelText(/nome completo/i)).toHaveValue("Fulano de Tal");
  });

  it("só libera o envio depois do aceite", () => {
    renderizar(PENDENTE);
    const botao = screen.getByRole("button", { name: /criar conta/i });

    expect(botao).toBeDisabled();
    preencherEAceitar();
    expect(botao).toBeEnabled();
  });

  it("envia ticket, versão dos termos e CPF/CNPJ só com dígitos", async () => {
    completarCadastroGoogle.mockResolvedValue({ success: true });
    renderizar(PENDENTE);

    preencherEAceitar();
    fireEvent.click(screen.getByRole("button", { name: /criar conta/i }));

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/onboarding"));
    expect(completarCadastroGoogle).toHaveBeenCalledWith({
      ticket: "t-1",
      name: "Fulano de Tal",
      cpfCnpj: "12345678901",
      oabNumber: "",
      termsVersion: TERMS_VERSION,
    });
  });

  it("volta para o login quando o ticket venceu", async () => {
    completarCadastroGoogle.mockResolvedValue({ success: false, expirado: true, error: "Expirou." });
    renderizar(PENDENTE);

    preencherEAceitar();
    fireEvent.click(screen.getByRole("button", { name: /criar conta/i }));

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/login", { replace: true }));
    expect(toast.error).toHaveBeenCalledWith("Expirou.");
  });

  it("fica na tela em erro de validação", async () => {
    completarCadastroGoogle.mockResolvedValue({ success: false, expirado: false, error: "CPF/CNPJ já cadastrado." });
    renderizar(PENDENTE);

    preencherEAceitar();
    fireEvent.click(screen.getByRole("button", { name: /criar conta/i }));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("CPF/CNPJ já cadastrado."));
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd frontend && npx vitest run src/tests/cadastroGoogle.test.jsx`
Expected: FAIL com `Failed to resolve import "../pages/CadastroGoogle.jsx"`.

- [ ] **Step 3: Criar `frontend/src/components/AceiteTermos.jsx`**

O texto é o que hoje está em `Register.jsx`, movido sem alteração:

```jsx
import { Link } from "react-router-dom";

/**
 * Caixa de aceite dos Termos de Uso e da Política de Privacidade.
 *
 * Um componente só para os dois cadastros (senha e Google). Os dois gravam a
 * mesma TERMS_VERSION; se mostrassem textos diferentes, a mesma versão
 * registraria aceites de conteúdos distintos.
 */
export default function AceiteTermos({ checked, onChange }) {
  return (
    <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm text-zinc-400">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span>
        Li e aceito os{" "}
        <Link to="/termos" target="_blank" className="text-primary underline underline-offset-2">
          Termos de Uso
        </Link>{" "}
        e a{" "}
        <Link to="/privacidade" target="_blank" className="text-primary underline underline-offset-2">
          Política de Privacidade
        </Link>
        . Declaro estar ciente de que o laudo é peça de apoio e depende de conferência
        humana antes de qualquer uso.
      </span>
    </label>
  );
}
```

- [ ] **Step 4: Criar `frontend/src/pages/CadastroGoogle.jsx`**

```jsx
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "../store/authStore";
import { TERMS_VERSION } from "../utils/legalVersion";
import { destinoAposLogin } from "../hooks/useEntrarComGoogle";
import AceiteTermos from "../components/AceiteTermos.jsx";
import logoImg from "../assets/logo.webp";

const CAMPO =
  "w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:ring-2 focus:ring-primary focus:outline-none";

/**
 * Complemento do cadastro de quem entrou com Google e ainda não tem conta.
 *
 * O Google confirmou nome e e-mail. Faltam o que ele não tem: CPF/CNPJ do
 * escritório, OAB e o aceite dos termos. O e-mail aparece só para leitura e
 * não é enviado: o servidor o tira do ticket, que é a prova do Google.
 */
export default function CadastroGoogle() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const completarCadastroGoogle = useAuthStore((s) => s.completarCadastroGoogle);

  const [name, setName] = useState(state?.name || "");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [oabNumber, setOabNumber] = useState("");
  const [aceitou, setAceitou] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sem ticket não há o que completar: a página foi aberta direto pela URL.
  if (!state?.ticket) return <Navigate to="/login" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const result = await completarCadastroGoogle({
      ticket: state.ticket,
      name,
      cpfCnpj: cpfCnpj.replace(/\D/g, ""),
      oabNumber,
      // A VERSÃO, e não um booleano: é ela que torna o aceite demonstrável.
      termsVersion: TERMS_VERSION,
    });
    setIsSubmitting(false);

    if (result.success) {
      toast.success("Conta criada com sucesso!");
      return navigate(destinoAposLogin());
    }

    toast.error(result.error);
    if (result.expirado) navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-xl relative z-10 text-center mb-8">
        <Link to="/" className="inline-flex items-center group mb-6">
          <img src={logoImg} alt="ForenseDoc" width="360" height="201" className="h-12 w-auto object-contain mx-auto transition-transform group-hover:scale-105" />
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Complete seu cadastro</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Você entrou como <strong className="text-zinc-200">{state.email}</strong>. Faltam os dados do
          escritório para liberar seus 3 laudos gratuitos.
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-xl relative z-10">
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="cg-nome" className="block text-sm font-medium text-zinc-300 mb-1">Nome completo</label>
                <input id="cg-nome" type="text" value={name} onChange={(e) => setName(e.target.value)} required minLength={3}
                  className={CAMPO} placeholder="Dr. João Silva" />
              </div>

              <div>
                <label htmlFor="cg-cpf" className="block text-sm font-medium text-zinc-300 mb-1">CPF ou CNPJ (somente números)</label>
                <input id="cg-cpf" type="text" value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} required
                  className={CAMPO} placeholder="00000000000" />
              </div>

              <div>
                <label htmlFor="cg-oab" className="block text-sm font-medium text-zinc-300 mb-1">
                  Número da OAB <span className="text-zinc-500">(Opcional)</span>
                </label>
                <input id="cg-oab" type="text" value={oabNumber} onChange={(e) => setOabNumber(e.target.value)}
                  className={CAMPO} placeholder="Ex: 123456" />
              </div>
            </div>

            <AceiteTermos checked={aceitou} onChange={setAceitou} />

            <button
              type="submit"
              disabled={isSubmitting || !aceitou}
              className="w-full mt-5 flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.2)] text-sm font-bold text-white bg-primary-solid hover:bg-primary-solid-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Criando conta...
                </>
              ) : (
                "Criar conta e ganhar 3 laudos"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Registrar a rota em `frontend/src/App.jsx`**

Depois de `import Register from "./pages/Register.jsx";`:

```jsx
import CadastroGoogle from "./pages/CadastroGoogle.jsx";
```

Depois de `<Route path="/register" element={<Register />} />`:

```jsx
        <Route path="/cadastro-google" element={<CadastroGoogle />} />
```

- [ ] **Step 6: Botão do Google e `AceiteTermos` em `frontend/src/pages/Register.jsx`**

Imports, depois de `import { TERMS_VERSION } from "../utils/legalVersion";`:

```jsx
import AceiteTermos from "../components/AceiteTermos.jsx";
import GoogleButton, { googleLoginDisponivel } from "../components/GoogleButton.jsx";
import { useEntrarComGoogle } from "../hooks/useEntrarComGoogle";
```

Depois de `const register = useAuthStore((state) => state.register);`:

```jsx
  // Quem já tem conta com TOTP e clica no Google aqui é levado ao login, que
  // é a tela que sabe pedir o código.
  const entrarComGoogle = useEntrarComGoogle({
    aoPedirTotp: (r) =>
      navigate("/login", {
        state: { challenge: r.challenge, recuperacaoDisponivel: r.recuperacaoDisponivel },
      }),
  });
```

No card, trocar

```jsx
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          <form className="space-y-5" onSubmit={handleSubmit}>
```

por

```jsx
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          {googleLoginDisponivel() && (
            <div className="mb-6 space-y-6">
              <GoogleButton onCredential={entrarComGoogle} texto="signup_with" />
              <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500">
                <span className="h-px flex-1 bg-surface-border" />
                ou cadastre-se com e-mail
                <span className="h-px flex-1 bg-surface-border" />
              </div>
            </div>
          )}
          <form className="space-y-5" onSubmit={handleSubmit}>
```

E substituir o `<label className="mt-6 flex cursor-pointer ...">` inteiro (do `<label` até o `</label>` correspondente, logo depois do comentário `{/* O aceite fica ANTES do botão ... */}`, que permanece) por:

```jsx
            <AceiteTermos checked={aceitou} onChange={setAceitou} />
```

Depois disso `Link` continua em uso em `Register.jsx` (cabeçalho e tela de sucesso); não removê-lo do import.

- [ ] **Step 7: Rodar a suíte inteira do frontend**

Run: `cd frontend && npx vitest run`
Expected: tudo PASS, incluindo `cadastroGoogle.test.jsx` (6 testes).

- [ ] **Step 8: Conferir o build de produção**

O build faz pré-renderização em SSR, que quebra se algum componente tocar `window` fora de efeito.

Run: `cd frontend && npm run build`
Expected: termina sem erro.

- [ ] **Step 9: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/components/AceiteTermos.jsx frontend/src/pages/CadastroGoogle.jsx frontend/src/pages/Register.jsx frontend/src/App.jsx frontend/src/tests/cadastroGoogle.test.jsx
/opt/homebrew/bin/git commit -m "feat(frontend): cadastro com Google e tela de complemento" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Documentação e verificação ponta a ponta

**Files:**
- Modify: `README.md` (nova seção depois de "Decisões de arquitetura")

- [ ] **Step 1: Acrescentar a seção ao `README.md`**

Inserir antes da seção `## Pré-requisitos`:

```markdown
## Login com Google

Opcional. Sem configuração, o sistema funciona só com e-mail e senha.

### Configurar no Google Cloud Console

1. Em **APIs e serviços > Tela de consentimento OAuth**, cadastre o aplicativo como **Externo**, com nome, logotipo, e-mail de suporte e os links de `/privacidade` e `/termos`. Escopos: apenas `openid`, `email` e `profile`, que não exigem verificação do Google.
2. Em **APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth**, escolha **Aplicativo da Web**.
3. Em **Origens JavaScript autorizadas**, informe as origens exatas do frontend, por exemplo `http://localhost:5173` e `https://forensedoc.com.br`. Não é preciso cadastrar URI de redirecionamento: o fluxo usa popup.
4. Copie o **ID do cliente**. Não existe client secret neste fluxo.

### Variáveis

| Onde | Variável | Valor |
|---|---|---|
| `backend/.env` | `GOOGLE_CLIENT_ID` | ID do cliente |
| `frontend/.env` | `VITE_GOOGLE_CLIENT_ID` | o mesmo ID do cliente |

A variável do frontend entra no bundle no momento do build: depois de mudá-la, rode `npm run build` de novo.

### Como funciona

- Conta já vinculada ao Google entra direto; se tiver verificação em duas etapas, o código continua sendo pedido.
- Conta existente com o mesmo e-mail, já confirmado, é vinculada no primeiro login com Google. Conta com e-mail ainda não confirmado não é vinculada: é preciso confirmar pelo link enviado no cadastro.
- E-mail sem conta leva à tela `/cadastro-google`, que pede CPF/CNPJ, OAB e o aceite dos termos antes de criar o escritório.
- Conta criada pelo Google não tem senha conhecida. Para passar a entrar também por senha, use "Esqueci a senha".

### Se um dia houver CSP no frontend

Hoje o nginx não envia `Content-Security-Policy` para as páginas do frontend. Se passar a enviar, libere `https://accounts.google.com/gsi/client` em `script-src`, `https://accounts.google.com/gsi/` em `frame-src` e `connect-src`, e `https://accounts.google.com/gsi/style` em `style-src`. E não use `Cross-Origin-Opener-Policy: same-origin` nas páginas de login e cadastro: ela impede o popup do Google de devolver a credencial (use `same-origin-allow-popups`).
```

- [ ] **Step 2: Rodar as duas suítes**

Run: `cd backend && npx vitest run && cd ../frontend && npx vitest run`
Expected: tudo PASS nos dois lados.

- [ ] **Step 3: Verificação manual com um Client ID real**

Pré-requisito: um ID do cliente criado conforme o README, com `http://localhost:5173` nas origens autorizadas, preenchido em `backend/.env` e `frontend/.env`.

```bash
cd /Users/narcisojunior/Documents/repositorios/Forense_DOC/forensedoc-ForenseDoc && bash start-dev.sh
```

Conferir, nesta ordem:

1. `/login` mostra o botão do Google acima do formulário, com a linha "ou com e-mail e senha".
2. Entrar com uma conta Google cujo e-mail não existe no banco: leva a `/cadastro-google` com o e-mail exibido. Preencher CPF/CNPJ novo, aceitar os termos, criar. Deve cair no `/onboarding` com 3 laudos no saldo.
3. Sair e entrar de novo com a mesma conta Google: entra direto, sem passar pelo complemento.
4. Em Configurações, ativar o TOTP. Sair e entrar com Google: deve pedir o código de 6 dígitos.
5. Criar uma conta por senha com outro e-mail seu, confirmar o e-mail pelo link, sair, e entrar com a conta Google desse e-mail: entra na mesma conta (confira pelo nome do escritório).
6. Criar uma conta por senha com um terceiro e-mail e NÃO confirmar. Entrar com a conta Google desse e-mail: deve aparecer a mensagem sobre cadastro aguardando confirmação.
7. Apagar `VITE_GOOGLE_CLIENT_ID` do `frontend/.env` e reiniciar o Vite: o botão some e o login por senha continua funcionando.

Conferir no banco a trilha de auditoria:

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U forensedoc -d forensedoc_dev -c "select action, \"createdAt\" from audit_logs where action in ('login_google','google_linked','terms_accepted','login_totp') order by \"createdAt\" desc limit 10;"
```

Expected: linhas `terms_accepted` e `login_google` do passo 2, `login_totp` do passo 4 e `google_linked` do passo 5. Se o nome do serviço do Postgres no `docker-compose.dev.yml` não for `postgres`, use o nome que aparece em `docker compose -f docker-compose.dev.yml ps`.

- [ ] **Step 4: Commit**

```bash
/opt/homebrew/bin/git add README.md
/opt/homebrew/bin/git commit -m "docs: configuração do login com Google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Pendências fora do código

Estas decisões não cabem a quem implementa e ficam com o responsável pelo produto:

1. **Criar o Client ID no Google Cloud Console** com a conta Google do escritório (não uma conta pessoal), para que o acesso ao projeto não dependa de uma pessoa.
2. **Política de Privacidade.** O Google passa a ser fonte de nome, e-mail e do identificador da conta Google (`sub`). O texto de `/privacidade` deveria mencionar isso. Mudar o texto implica decidir se sobe a `TERMS_VERSION` (o que exige novo aceite de todos na próxima vez) ou se é ajuste que não altera direitos. Recomendo revisão jurídica antes de publicar a funcionalidade em produção.
3. **Tela de consentimento em modo de produção.** Enquanto o app estiver em "Teste" no Google Cloud, só os e-mails cadastrados como testadores conseguem entrar. Com apenas os escopos `openid`, `email` e `profile`, a publicação não exige a verificação demorada do Google.
