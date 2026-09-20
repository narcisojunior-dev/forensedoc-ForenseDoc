# Verificação Pública de Laudos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada laudo emitido um hash próprio e um código de verificação, imprimir um QR Code no PDF e publicar uma página que confirma a autenticidade do laudo sem expor dados pessoais do titular.

**Architecture:** Na emissão do laudo o servidor calcula o SHA-256 do conteúdo canônico do `result`, gera um código de verificação de 60 bits e grava uma linha em `laudo_verifications` com um retrato já mascarado dos poucos campos que a página pública mostra. A leitura pública nunca toca o `result` nem a tabela `analyses`: ela responde a partir desse retrato congelado, o que torna o mascaramento uma garantia de escrita e não uma filtragem de leitura. O PDF ganha um QR apontando para `/verificar/<codigo>`, desenhado em vetor com a biblioteca `qrcode-svg` que já é dependência do projeto.

**Tech Stack:** Node 20, Express 4, Prisma 7 + Postgres, PDFKit 0.19, `qrcode-svg` 1.1, BullMQ, Vitest no backend; React 18, Vite 5, Tailwind 3, React Router 7, Vitest + Testing Library no frontend.

## Global Constraints

- Nenhuma dependência nova. `qrcode-svg` já está em `backend/package.json` e é usada em `src/controllers/totpController.js`.
- Comentários de código em português, explicando o porquê da decisão e não o que a linha faz. É o padrão de todo o repositório.
- Nenhum dado pessoal em texto claro na resposta pública. O que sai mascarado da emissão é o que a rota devolve, sem exceção.
- Rota pública responde sempre o mesmo corpo de erro para chave inexistente e para chave malformada, para não confirmar a existência de um laudo por diferença de mensagem.
- Testes com Vitest nos dois lados. Backend: `cd backend && npx vitest run`. Frontend: `cd frontend && npx vitest run`.
- `git` do sistema falha por licença do Xcode neste ambiente. Usar `/opt/homebrew/bin/git`.
- O ambiente local sobe com `bash start-dev.sh` na raiz de `forensedoc-ForenseDoc` (o script não tem bit de execução).
- Migrations: `cd backend && npx prisma migrate dev --name <nome>` com `DATABASE_URL` apontando para o Postgres local da porta 55432.

---

## Decisões de projeto

Esta seção existe porque várias escolhas abaixo contrariam o caminho óbvio. Quem for implementar precisa saber o motivo antes de "simplificar" alguma delas.

### 1. O hash é do conteúdo do laudo, não dos bytes do PDF

O caminho intuitivo seria calcular o SHA-256 do arquivo PDF entregue. Ele não funciona aqui. O PDF é gerado sob demanda a cada download em `getAnalysisPdf` (`backend/src/controllers/analyzeController.js`), e o PDFKit grava `CreationDate`, `ModDate` e um `/ID` aleatório em cada geração. Dois downloads do mesmo laudo produzem arquivos com hashes diferentes, e a verificação falharia na segunda tentativa sem que nada tivesse sido adulterado.

A solução é calcular o hash sobre uma serialização canônica do objeto `result` que já fica persistido em `analyses.result`. Esse objeto é o laudo: o PDF e a tela são duas apresentações dele. Canônico significa chaves ordenadas recursivamente, para que a ordem de serialização do Postgres ou do Prisma não altere o resultado.

Consequência a comunicar na página: o que se verifica é o conteúdo do laudo, não o arquivo. Um PDF adulterado continua tendo o hash original impresso, e é exatamente por isso que a página mostra o nome mascarado do titular: quem confere compara o que está na tela com o que está no papel.

### 2. Duas chaves de busca, uma página

O usuário digita ou escaneia uma de duas coisas:

- **Código de verificação**, 12 caracteres em base32 de Crockford, formatado `FD-XXXX-XXXX-XXXX`. É o que vai no QR e o que se digita quando o QR não abre. Alfabeto sem `I`, `L`, `O` e `U`, e a normalização mapeia `I`/`L` para `1` e `O` para `0`, porque quem digita de um papel confunde essas letras.
- **Hash SHA-256 do laudo**, 64 hexadecimais. É o que o usuário copia do laudo e cola na busca, que foi o pedido original.

Os dois caminham para a mesma rota e a mesma tela. `32^12` é `2^60`: com o limite de 20 consultas por minuto por IP, varrer o espaço levaria mais tempo que a idade do universo, então o código pode ser curto sem virar enumerável.

`reportId` (o protocolo `FD-20260919-A1B2C3D4E5` que já existe em `result.reportId`) **não** serve como chave de busca. Ele é derivado da data e dos dez primeiros caracteres do hash do documento analisado, é previsível, e aceitar previsível como chave de uma página pública seria abrir a enumeração que o código de verificação existe para fechar. Ele aparece na página como informação, nunca como entrada.

### 3. Mascarar também na página do QR

O pedido original era nome completo na página do QR e mascaramento apenas na busca por hash. O plano mascara nos dois, e a razão é a seguinte: o QR viaja dentro do PDF, e o PDF é encaminhado por e-mail, anexado a processo, impresso e arquivado. Uma URL que renderiza nome completo e CPF vira um índice aberto de quem teve dossiê analisado, alcançável por qualquer pessoa que passe pelo documento em qualquer ponto da cadeia.

O objetivo declarado pelo usuário continua atendido. A garantia de que o hash e o QR não foram trocados vem de comparar a tela com o laudo em mãos, e `R***** M****** DE S****` mais `***.456.789-**` confirmam identidade para quem já sabe de quem se trata sem revelar nada para quem não sabe. É o princípio da necessidade da LGPD (art. 6º, III) aplicado ao caso: o mínimo que cumpre a finalidade.

### 4. A página pública não conta o resultado da perícia

A tela mostra que o laudo é autêntico. Não mostra quantas irregularidades foram encontradas, nem a gravidade, nem o sumário executivo. Quem escaneia um QR não deveria ficar sabendo que o contrato daquela pessoa tem sete achados: isso é informação sobre o titular, e em muitos casos sobre um litígio em curso. Autenticidade e conteúdo são perguntas diferentes, e só a primeira é pública.

### 5. Quatro situações possíveis, não duas

Uma página de verificação que só sabe dizer "válido" não verifica nada. O sistema já recalcula laudos depois de emitidos: `recomputeDerived` é chamado em `correctAnalysisGeo` (`analyzeController.js:451`) e em `reviewAnalysisFields` (`analyzeController.js:691`). Sem controle de versão, um laudo impresso em março continuaria se apresentando como válido depois de a análise ter sido corrigida em abril, e a página estaria mentindo.

| Situação | Quando | O que a página diz |
|---|---|---|
| `VALIDO` | emissão corrente | laudo autêntico, com os hashes e o titular mascarado |
| `SUBSTITUIDO` | o conteúdo mudou e gerou nova emissão | laudo autêntico na data, substituído por outro, com o código novo |
| `CANCELADO` | revogado pelo operador da plataforma | laudo cancelado, com a data e o motivo |
| `DADOS_REMOVIDOS` | eliminação a pedido do titular ou exclusão da conta | os hashes conferem, os dados pessoais não são mais exibidos |

### 6. Retrato congelado e mascarado na escrita

A linha de verificação guarda um campo `publicSnapshot` com os poucos valores que a página mostra, já mascarados no momento da emissão. A página pública lê dali e nunca abre `analyses.result`.

Três ganhos. Primeiro, um defeito futuro na função de mascaramento não vaza histórico, porque o histórico já está gravado mascarado. Segundo, a rota pública não depende de uma linha de `analyses` que a política de retenção pode ter alterado. Terceiro, a eliminação a pedido do titular vira uma operação de uma linha (limpar o snapshot e mudar o status) em vez de uma caçada por campos derivados.

### 7. Por que tabela separada e não colunas em `analyses`

`analyses` é apagada em cascata quando o tenant é excluído (`onDelete: Cascade` no schema). O registro de verificação precisa sobreviver a isso em estado degradado, porque o hash de um laudo que circulou continua sendo um fato verificável mesmo depois de o escritório encerrar a conta. A relação com `Analysis` usa `onDelete: SetNull`, e `tenantId` é coluna simples sem relação, justamente para não herdar a cascata.

---

## Estrutura de arquivos

### Backend, arquivos novos

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/utils/mascarar.js` | Mascaramento de nome e CPF. Puro, sem dependências. |
| `backend/src/services/laudoVerificacao.js` | Canonicalização, hash do laudo, geração e normalização do código, montagem do snapshot público. Puro. |
| `backend/src/services/verificacaoStore.js` | Escrita e leitura da tabela `laudo_verifications`. Único módulo que fala com o Prisma nesse assunto. |
| `backend/src/controllers/verificacaoController.js` | Rota pública de consulta. |
| `backend/src/routes/publicRoutes.js` | Montagem e limite de taxa da rota pública. |
| `backend/src/reports/qrVerificacao.js` | Desenho do QR em vetor no PDFKit. |
| `backend/scripts/backfill-verificacoes.js` | Cria registros para os laudos já emitidos. |

### Backend, arquivos modificados

| Arquivo | Mudança |
|---|---|
| `backend/prisma/schema.prisma` | Modelo `LaudoVerification` e enum `LaudoVerificationStatus`. |
| `backend/src/jobs/analysisWorker.js:100-105` | Emitir a verificação junto com o `COMPLETED`. |
| `backend/src/controllers/analyzeController.js:451,691` | Substituir a verificação quando o conteúdo é recalculado. |
| `backend/src/services/reportPdfService.js` | Imprimir código, hash do laudo e QR. |
| `backend/src/routes/index.js` | Montar `/public`. |
| `backend/src/routes/adminRoutes.js` | Rota de cancelamento. |
| `backend/src/controllers/adminController.js` | Handler do cancelamento. |
| `backend/.env.example` | Documentar `FRONTEND_URL` como base do QR. |

### Frontend, arquivos novos

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/pages/VerificarLaudo.jsx` | Página pública: formulário de busca e resultado. |
| `frontend/src/tests/verificarLaudo.test.jsx` | Testes da página. |

### Frontend, arquivos modificados

| Arquivo | Mudança |
|---|---|
| `frontend/src/App.jsx` | Rotas públicas `/verificar` e `/verificar/:chave`. |
| `frontend/src/components/Layout/Header.jsx` | Entrada "Verificar laudo" no topo da landing. |
| `frontend/src/pages/Landing.jsx` | Entrada no rodapé da landing. |
| `frontend/src/pages/legal/Privacidade.jsx` | Declarar o novo tratamento e a página pública. |

---

## Tarefas

### Task 1: Mascaramento de nome e CPF

**Files:**
- Create: `backend/src/utils/mascarar.js`
- Test: `backend/tests/mascarar.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `mascararNome(nome: string|null): string|null`, `mascararCpf(cpf: string|null): string|null`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/mascarar.test.js`:

```js
import { describe, it, expect } from "vitest";
import { mascararNome, mascararCpf } from "../src/utils/mascarar.js";

describe("mascararNome", () => {
  it("mantém a inicial de cada palavra e preserva o comprimento", () => {
    expect(mascararNome("Ronney Menezes de Souza")).toBe("R***** M****** de S****");
  });

  it("preserva partículas de até duas letras, que não identificam ninguém", () => {
    expect(mascararNome("Ana da Silva")).toBe("A** da S****");
  });

  it("normaliza espaços repetidos sem alterar a contagem de palavras", () => {
    expect(mascararNome("  Joao   Pedro  ")).toBe("J*** P****");
  });

  it("devolve null para entrada vazia, para a página não imprimir string vazia", () => {
    expect(mascararNome("")).toBeNull();
    expect(mascararNome(null)).toBeNull();
  });
});

describe("mascararCpf", () => {
  it("usa a convenção de divulgação parcial: três primeiros e dois últimos ocultos", () => {
    expect(mascararCpf("123.456.789-00")).toBe("***.456.789-**");
  });

  it("aceita o número sem formatação", () => {
    expect(mascararCpf("12345678900")).toBe("***.456.789-**");
  });

  it("recusa o que não tem onze dígitos, em vez de mascarar lixo", () => {
    expect(mascararCpf("123")).toBeNull();
    expect(mascararCpf(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/mascarar.test.js
```

Esperado: FAIL com `Failed to load url ../src/utils/mascarar.js`.

- [ ] **Step 3: Implementar**

Criar `backend/src/utils/mascarar.js`:

```js
/**
 * Mascaramento para a página pública de verificação de laudo.
 *
 * A página existe para que alguém com o laudo em mãos confirme que o QR e o
 * hash não foram trocados. Para isso basta RECONHECER o titular, não é preciso
 * identificá-lo: quem já sabe de quem se trata confirma, quem não sabe não
 * descobre. É o princípio da necessidade (LGPD, art. 6º, III).
 *
 * O comprimento é preservado de propósito. "R***** M******" e "R** M*" são
 * pessoas diferentes para quem confere, e esconder o tamanho tornaria a
 * conferência inútil sem proteger mais ninguém.
 */

/** Partículas com até duas letras (de, da, do, e) não identificam e ficam. */
const TAMANHO_MINIMO_PARA_MASCARAR = 3;

export function mascararNome(nome) {
  if (typeof nome !== "string") return null;
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return null;

  return palavras
    .map((palavra) => {
      if (palavra.length < TAMANHO_MINIMO_PARA_MASCARAR) return palavra;
      return palavra[0].toUpperCase() + "*".repeat(palavra.length - 1);
    })
    .join(" ");
}

/**
 * CPF na convenção de divulgação parcial já usada por Receita Federal e CNJ:
 * ocultos os três primeiros e os dois últimos dígitos. Os seis do meio bastam
 * para conferir e não permitem reconstruir o número, porque os dois finais são
 * justamente os verificadores.
 */
export function mascararCpf(cpf) {
  if (typeof cpf !== "string") return null;
  const digitos = cpf.replace(/\D/g, "");
  if (digitos.length !== 11) return null;
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/mascarar.test.js
```

Esperado: `Tests  7 passed`.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add backend/src/utils/mascarar.js backend/tests/mascarar.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): mascaramento de nome e CPF para a pagina publica"
```

---

### Task 2: Hash canônico do laudo e código de verificação

**Files:**
- Create: `backend/src/services/laudoVerificacao.js`
- Test: `backend/tests/laudoVerificacao.test.js`

**Interfaces:**
- Consumes: `mascararNome`, `mascararCpf` da Task 1.
- Produces:
  - `canonicalizar(valor: any): string`
  - `hashDoLaudo(result: object): string` (64 hex maiúsculos)
  - `gerarCodigo(): string` (`FD-XXXX-XXXX-XXXX`)
  - `normalizarChave(entrada: string): { tipo: "codigo"|"hash"|null, valor: string|null }`
  - `montarSnapshotPublico(result: object): object`

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/laudoVerificacao.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  canonicalizar,
  hashDoLaudo,
  gerarCodigo,
  normalizarChave,
  montarSnapshotPublico,
} from "../src/services/laudoVerificacao.js";

describe("canonicalizar", () => {
  it("ordena as chaves para que a ordem de serialização não mude o hash", () => {
    expect(canonicalizar({ b: 1, a: 2 })).toBe(canonicalizar({ a: 2, b: 1 }));
  });

  it("ordena em profundidade", () => {
    expect(canonicalizar({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it("preserva a ordem de arrays, que é conteúdo e não acidente", () => {
    expect(canonicalizar([2, 1])).toBe("[2,1]");
  });
});

describe("hashDoLaudo", () => {
  const result = { reportId: "FD-1", generatedAt: "2026-09-19T00:00:00.000Z", hashes: { sha256: "AA" } };

  it("é estável para o mesmo conteúdo", () => {
    expect(hashDoLaudo(result)).toBe(hashDoLaudo({ ...result }));
  });

  it("muda quando qualquer campo do laudo muda", () => {
    expect(hashDoLaudo(result)).not.toBe(hashDoLaudo({ ...result, reportId: "FD-2" }));
  });

  it("devolve 64 hexadecimais maiúsculos", () => {
    expect(hashDoLaudo(result)).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("gerarCodigo", () => {
  it("usa o formato impresso no laudo", () => {
    expect(gerarCodigo()).toMatch(/^FD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("não repete em mil gerações", () => {
    const vistos = new Set(Array.from({ length: 1000 }, () => gerarCodigo()));
    expect(vistos.size).toBe(1000);
  });
});

describe("normalizarChave", () => {
  it("aceita o código com ou sem hífen e em minúsculas", () => {
    expect(normalizarChave("fd7kq29xmr4tvb")).toEqual({ tipo: "codigo", valor: "FD-7KQ2-9XMR-4TVB" });
  });

  it("corrige as letras que se confundem ao digitar de um papel", () => {
    // I e L viram 1, O vira 0 (regra do base32 de Crockford).
    expect(normalizarChave("FD-IKQO-9XMR-4TVB").valor).toBe("FD-1KQ0-9XMR-4TVB");
  });

  it("aceita corpo que começa com FD sem confundir com o prefixo", () => {
    expect(normalizarChave("FD-FD12-3456-789A").valor).toBe("FD-FD12-3456-789A");
  });

  it("reconhece o hash de 64 hexadecimais", () => {
    const hash = "a".repeat(64);
    expect(normalizarChave(hash)).toEqual({ tipo: "hash", valor: "A".repeat(64) });
  });

  it("recusa o que não é nem um nem outro", () => {
    expect(normalizarChave("abc")).toEqual({ tipo: null, valor: null });
    expect(normalizarChave(null)).toEqual({ tipo: null, valor: null });
  });
});

describe("montarSnapshotPublico", () => {
  const result = {
    reportId: "FD-20260919-A1B2C3D4E5",
    generatedAt: "2026-09-19T12:00:00.000Z",
    hashes: { sha256: "ABC", sha1: "DEF" },
    file: { name: "contrato-ronney-menezes.pdf" },
    text: JSON.stringify({ cliente: { nome: "Ronney Menezes de Souza", cpf: "123.456.789-00" } }),
  };

  it("mascara o titular", () => {
    const s = montarSnapshotPublico(result);
    expect(s.titular).toEqual({ nome: "R***** M****** de S****", cpf: "***.456.789-**" });
  });

  it("leva os hashes do documento analisado, que não são dado pessoal", () => {
    expect(montarSnapshotPublico(result).documentoAnalisado).toEqual({ sha256: "ABC", sha1: "DEF" });
  });

  it("NÃO leva o nome do arquivo, que costuma carregar o nome do titular", () => {
    expect(JSON.stringify(montarSnapshotPublico(result))).not.toMatch(/contrato-ronney/i);
  });

  it("NÃO leva o veredito da perícia: autenticidade e conteúdo são perguntas diferentes", () => {
    const comSumario = { ...result, sumarioIrregularidades: { placar: { alta: 7 } } };
    expect(JSON.stringify(montarSnapshotPublico(comSumario))).not.toMatch(/placar|alta/);
  });

  it("aguenta laudo sem titular extraído", () => {
    const s = montarSnapshotPublico({ ...result, text: "{}" });
    expect(s.titular).toEqual({ nome: null, cpf: null });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/laudoVerificacao.test.js
```

Esperado: FAIL com `Failed to load url ../src/services/laudoVerificacao.js`.

- [ ] **Step 3: Implementar**

Criar `backend/src/services/laudoVerificacao.js`:

```js
import crypto from "node:crypto";
import { mascararNome, mascararCpf } from "../utils/mascarar.js";

/**
 * Identidade criptográfica do laudo, para a verificação pública.
 *
 * ─── Por que o hash NÃO é do arquivo PDF ─────────────────────────────────────
 *
 * O PDF é gerado a cada download (`getAnalysisPdf`) e o PDFKit grava
 * CreationDate, ModDate e um /ID novo em cada geração. Dois downloads do mesmo
 * laudo dão arquivos com hashes diferentes, e a verificação falharia na segunda
 * conferência sem que nada tivesse sido adulterado.
 *
 * O que se verifica aqui é o CONTEÚDO: o objeto `result` persistido em
 * `analyses.result`, que é o laudo de verdade. O PDF e a tela são duas
 * apresentações dele.
 */

/**
 * Serialização canônica: chaves ordenadas em profundidade.
 *
 * Sem isso, o hash dependeria da ordem em que o Postgres devolve as chaves do
 * JSONB, que não é garantida entre versões. A ordem dos arrays é preservada
 * porque ali ela é conteúdo (a sequência dos achados, das páginas, dos IPs).
 */
export function canonicalizar(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(canonicalizar).join(",")}]`;
  const chaves = Object.keys(valor).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${canonicalizar(valor[k])}`).join(",")}}`;
}

export function hashDoLaudo(result) {
  return crypto.createHash("sha256").update(canonicalizar(result), "utf8").digest("hex").toUpperCase();
}

// Base32 de Crockford: sem I, L, O e U. As três primeiras se confundem com 1 e
// 0 na leitura de um papel; o U sai para não formar palavra ofensiva por acaso.
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TAMANHO_CODIGO = 12; // 32^12 = 2^60, fora do alcance de enumeração

export function gerarCodigo() {
  const bytes = crypto.randomBytes(TAMANHO_CODIGO);
  let bruto = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) bruto += ALFABETO[bytes[i] % ALFABETO.length];
  return `FD-${bruto.slice(0, 4)}-${bruto.slice(4, 8)}-${bruto.slice(8, 12)}`;
}

/**
 * Descobre se a entrada é código ou hash e devolve na forma canônica.
 *
 * A correção de I/L/O existe porque a alternativa é um usuário que digitou o
 * código certo receber "laudo não encontrado". As duas chaves convivem na mesma
 * caixa de busca: o hash é o que se copia do laudo, o código é o que se digita.
 */
export function normalizarChave(entrada) {
  if (typeof entrada !== "string") return { tipo: null, valor: null };
  const limpo = entrada.trim().toUpperCase();

  if (/^[0-9A-F]{64}$/.test(limpo)) return { tipo: "hash", valor: limpo };

  // O prefixo só é retirado quando a retirada deixa o corpo no tamanho certo.
  // Um código cujo corpo comece com FD ("FD-FD12-3456-789A") seria truncado por
  // um replace incondicional, e o usuário receberia "laudo não encontrado" com
  // o código correto na mão.
  let corpo = limpo.replace(/[^0-9A-Z]/g, "");
  if (corpo.length === TAMANHO_CODIGO + 2 && corpo.startsWith("FD")) corpo = corpo.slice(2);
  corpo = corpo.replace(/[IL]/g, "1").replace(/O/g, "0");

  if (corpo.length !== TAMANHO_CODIGO || [...corpo].some((c) => !ALFABETO.includes(c))) {
    return { tipo: null, valor: null };
  }
  return { tipo: "codigo", valor: `FD-${corpo.slice(0, 4)}-${corpo.slice(4, 8)}-${corpo.slice(8, 12)}` };
}

/**
 * Retrato público do laudo, JÁ MASCARADO.
 *
 * É uma lista de permissão, nunca de exclusão. O `result` ganha campos a cada
 * evolução do motor, e uma lista de exclusão passaria a vazar o campo novo no
 * dia em que ele nascesse, sem ninguém perceber.
 *
 * Fica de fora, de propósito: o nome do arquivo (costuma trazer o nome do
 * titular), o veredito da perícia (é informação sobre o titular e sobre um
 * litígio em curso) e qualquer endereço, IP ou coordenada.
 */
export function montarSnapshotPublico(result) {
  let extraido = {};
  try {
    extraido = JSON.parse(result?.text || "{}") || {};
  } catch {
    extraido = {};
  }
  const cliente = extraido.cliente || {};

  return {
    titular: {
      nome: mascararNome(cliente.nome ?? null),
      cpf: mascararCpf(cliente.cpf ?? null),
    },
    documentoAnalisado: {
      sha256: result?.hashes?.sha256 ?? null,
      sha1: result?.hashes?.sha1 ?? null,
    },
    emissor: "ForenseDoc",
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/laudoVerificacao.test.js
```

Esperado: `Tests  18 passed`.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add backend/src/services/laudoVerificacao.js backend/tests/laudoVerificacao.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): hash canonico do laudo, codigo de verificacao e snapshot publico"
```

---

### Task 3: Tabela `laudo_verifications` e o store

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelo `Analysis`, fim do arquivo)
- Create: `backend/src/services/verificacaoStore.js`
- Test: `backend/tests/verificacaoStore.test.js`

**Interfaces:**
- Consumes: `hashDoLaudo`, `gerarCodigo`, `montarSnapshotPublico` da Task 2.
- Produces:
  - `emitirVerificacao({ analysisId, tenantId, result }): Promise<registro>`
  - `buscarPorChave({ tipo, valor }): Promise<registro|null>`
  - `cancelarVerificacao(codigo, motivo): Promise<registro>`
  - `anonimizarVerificacao(id): Promise<registro>`

- [ ] **Step 1: Declarar o modelo no schema**

Em `backend/prisma/schema.prisma`, dentro de `model Analysis`, acrescentar a relação inversa logo abaixo de `creditTransactions`:

```prisma
  // Uma análise pode ter várias verificações ao longo do tempo: cada correção
  // de campo ou de coordenada emite um laudo novo e aposenta o anterior.
  verifications      LaudoVerification[]
```

E ao fim do arquivo:

```prisma
// ─────────────────────────────────────────────
// VERIFICAÇÃO PÚBLICA DE LAUDO
// ─────────────────────────────────────────────

enum LaudoVerificationStatus {
  VALIDO
  SUBSTITUIDO
  CANCELADO
  DADOS_REMOVIDOS
}

/**
 * Registro que sustenta a página pública de verificação.
 *
 * Vive fora de `analyses` de propósito. `analyses` é apagada em cascata quando
 * o tenant é excluído, e o hash de um laudo que já circulou continua sendo um
 * fato verificável depois disso: quem recebeu o documento precisa poder
 * conferir a autenticidade mesmo que o escritório tenha encerrado a conta. A
 * relação usa SetNull, e `tenantId` é coluna solta, sem relação, para não
 * herdar a cascata.
 *
 * `publicSnapshot` guarda os poucos campos que a página mostra, JÁ MASCARADOS
 * na emissão. A leitura pública nunca abre `analyses.result`: mascarar na
 * escrita faz com que um defeito futuro na função de máscara não vaze
 * histórico, porque o histórico já está gravado mascarado.
 */
model LaudoVerification {
  id        String                  @id @default(uuid())
  codigo    String                  @unique // FD-XXXX-XXXX-XXXX, 60 bits
  laudoHash String                  @unique // SHA-256 do conteúdo canônico
  reportId  String
  status    LaudoVerificationStatus @default(VALIDO)
  emitidoEm DateTime

  publicSnapshot Json

  analysisId String?
  tenantId   String?

  substituidoPorId String?   @unique
  canceladoEm      DateTime?
  canceladoMotivo  String?
  dadosRemovidosEm DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  analysis       Analysis?          @relation(fields: [analysisId], references: [id], onDelete: SetNull)
  substituidoPor LaudoVerification? @relation("Substituicao", fields: [substituidoPorId], references: [id])
  substitui      LaudoVerification? @relation("Substituicao")

  @@index([analysisId])
  @@index([tenantId])
  @@map("laudo_verifications")
}
```

- [ ] **Step 2: Gerar a migration e o client**

```bash
cd backend && DATABASE_URL="postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev" npx prisma migrate dev --name add_laudo_verifications
```

Esperado: `Your database is now in sync with your schema` e um diretório novo em `prisma/migrations/`.

Em seguida, **regerar o client explicitamente**:

```bash
cd backend && DATABASE_URL="postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev" npx prisma generate
```

Este projeto usa Prisma 7 com `prisma.config.ts`, e nessa configuração o `migrate dev` aplica a migration mas **não** regenera o client. Sem este passo a tabela existe no banco, os testes passam (eles mockam o Prisma) e a rota quebra em produção com `Cannot read properties of undefined (reading 'findUnique')`. Conferir antes de seguir:

```bash
cd backend && DATABASE_URL="postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev" node --input-type=module -e "import { prisma } from './src/utils/prisma.js'; console.log(typeof prisma.laudoVerification); await prisma.\$disconnect();"
```

Esperado: `object`. Se sair `undefined`, o client não foi regerado.

- [ ] **Step 3: Escrever o teste que falha**

Criar `backend/tests/verificacaoStore.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

const db = vi.hoisted(() => ({ linhas: [] }));

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    laudoVerification: {
      create: vi.fn(async ({ data }) => {
        const linha = { id: `v${db.linhas.length + 1}`, substituidoPorId: null, ...data };
        db.linhas.push(linha);
        return linha;
      }),
      findUnique: vi.fn(async ({ where }) => {
        const chave = Object.keys(where)[0];
        return db.linhas.find((l) => l[chave] === where[chave]) || null;
      }),
      update: vi.fn(async ({ where, data }) => {
        const linha = db.linhas.find((l) => l.id === where.id || l.codigo === where.codigo);
        Object.assign(linha, data);
        return linha;
      }),
    },
  },
}));

const { emitirVerificacao, buscarPorChave, cancelarVerificacao, anonimizarVerificacao } = await import(
  "../src/services/verificacaoStore.js"
);

const result = {
  reportId: "FD-20260919-A1B2C3D4E5",
  generatedAt: "2026-09-19T12:00:00.000Z",
  hashes: { sha256: "ABC", sha1: "DEF" },
  text: JSON.stringify({ cliente: { nome: "Ronney Menezes", cpf: "12345678900" } }),
};

beforeEach(() => {
  db.linhas = [];
});

describe("emitirVerificacao", () => {
  it("grava código, hash e snapshot mascarado", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect(v.codigo).toMatch(/^FD-/);
    expect(v.laudoHash).toMatch(/^[0-9A-F]{64}$/);
    expect(v.status).toBe("VALIDO");
    expect(v.publicSnapshot.titular.nome).toBe("R***** M******");
  });

  it("não grava nada em texto claro no snapshot", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect(JSON.stringify(v.publicSnapshot)).not.toMatch(/Ronney|12345678900/);
  });

  it("aposenta a verificação anterior quando o laudo é reemitido", async () => {
    const antiga = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const nova = await emitirVerificacao({
      analysisId: "a1",
      tenantId: "t1",
      result: { ...result, generatedAt: "2026-09-20T12:00:00.000Z" },
      substituindo: antiga.id,
    });
    const recarregada = db.linhas.find((l) => l.id === antiga.id);
    expect(recarregada.status).toBe("SUBSTITUIDO");
    expect(recarregada.substituidoPorId).toBe(nova.id);
  });
});

describe("buscarPorChave", () => {
  it("acha pelo código", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect((await buscarPorChave({ tipo: "codigo", valor: v.codigo })).id).toBe(v.id);
  });

  it("acha pelo hash", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    expect((await buscarPorChave({ tipo: "hash", valor: v.laudoHash })).id).toBe(v.id);
  });

  it("devolve null para chave sem tipo, sem consultar o banco", async () => {
    expect(await buscarPorChave({ tipo: null, valor: null })).toBeNull();
  });
});

describe("cancelarVerificacao", () => {
  it("registra a data e o motivo", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const c = await cancelarVerificacao(v.codigo, "emitido sobre arquivo errado");
    expect(c.status).toBe("CANCELADO");
    expect(c.canceladoMotivo).toBe("emitido sobre arquivo errado");
    expect(c.canceladoEm).toBeInstanceOf(Date);
  });
});

describe("anonimizarVerificacao", () => {
  it("esvazia o titular e mantém os hashes, que não são dado pessoal", async () => {
    const v = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const a = await anonimizarVerificacao(v.id);
    expect(a.status).toBe("DADOS_REMOVIDOS");
    expect(a.publicSnapshot.titular).toEqual({ nome: null, cpf: null });
    expect(a.publicSnapshot.documentoAnalisado.sha256).toBe("ABC");
    expect(a.tenantId).toBeNull();
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/verificacaoStore.test.js
```

Esperado: FAIL com `Failed to load url ../src/services/verificacaoStore.js`.

- [ ] **Step 5: Implementar**

Criar `backend/src/services/verificacaoStore.js`:

```js
import { prisma } from "../utils/prisma.js";
import { hashDoLaudo, gerarCodigo, montarSnapshotPublico } from "./laudoVerificacao.js";

/**
 * Único módulo que escreve e lê `laudo_verifications`.
 *
 * A concentração é intencional: a regra de "o que pode aparecer na página
 * pública" tem que ter um lugar só. Espalhar consultas a esta tabela pelos
 * controllers seria o caminho mais curto para alguém devolver o registro
 * inteiro, com `tenantId` e `analysisId`, numa rota sem autenticação.
 */

/**
 * @param {object} params
 * @param {string} params.analysisId
 * @param {string} params.tenantId
 * @param {object} params.result   snapshot persistido em analyses.result
 * @param {string} [params.substituindo] id da verificação que esta aposenta
 */
export async function emitirVerificacao({ analysisId, tenantId, result, substituindo = null }) {
  const nova = await prisma.laudoVerification.create({
    data: {
      codigo: gerarCodigo(),
      laudoHash: hashDoLaudo(result),
      reportId: result?.reportId || "",
      emitidoEm: result?.generatedAt ? new Date(result.generatedAt) : new Date(),
      publicSnapshot: montarSnapshotPublico(result),
      status: "VALIDO",
      analysisId,
      tenantId,
    },
  });

  // A anterior só é aposentada DEPOIS de a nova existir. Na ordem inversa, uma
  // falha no meio deixaria o laudo que já circulou marcado como substituído
  // por nada, e a página diria "substituído" sem ter o que mostrar no lugar.
  if (substituindo) {
    await prisma.laudoVerification.update({
      where: { id: substituindo },
      data: { status: "SUBSTITUIDO", substituidoPorId: nova.id },
    });
  }

  return nova;
}

export async function buscarPorChave({ tipo, valor }) {
  if (!tipo || !valor) return null;
  const where = tipo === "hash" ? { laudoHash: valor } : { codigo: valor };
  return prisma.laudoVerification.findUnique({ where });
}

export async function cancelarVerificacao(codigo, motivo) {
  return prisma.laudoVerification.update({
    where: { codigo },
    data: { status: "CANCELADO", canceladoEm: new Date(), canceladoMotivo: motivo },
  });
}

/**
 * Eliminação a pedido do titular (LGPD, art. 18, VI).
 *
 * Os hashes ficam. Um resumo criptográfico não identifica ninguém sozinho, e é
 * o que permite a quem recebeu o laudo continuar conferindo que o documento em
 * mãos é o que foi emitido. O que sai é o titular mascarado e o vínculo com o
 * tenant, que são os dados pessoais do registro.
 */
export async function anonimizarVerificacao(id) {
  const atual = await prisma.laudoVerification.findUnique({ where: { id } });
  if (!atual) return null;

  return prisma.laudoVerification.update({
    where: { id },
    data: {
      status: "DADOS_REMOVIDOS",
      dadosRemovidosEm: new Date(),
      tenantId: null,
      publicSnapshot: {
        ...atual.publicSnapshot,
        titular: { nome: null, cpf: null },
      },
    },
  });
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/verificacaoStore.test.js
```

Esperado: `Tests  8 passed`.

- [ ] **Step 7: Commit**

```bash
/opt/homebrew/bin/git add backend/prisma backend/src/services/verificacaoStore.js backend/tests/verificacaoStore.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): tabela laudo_verifications e store de emissao"
```

---

### Task 4: Emitir a verificação junto com o laudo

**Files:**
- Modify: `backend/src/jobs/analysisWorker.js` (bloco do `prisma.analysis.update`, por volta da linha 100)
- Test: `backend/tests/emissaoVerificacao.test.js`

**Interfaces:**
- Consumes: `emitirVerificacao` da Task 3.
- Produces: toda análise `COMPLETED` passa a ter uma linha em `laudo_verifications`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/emissaoVerificacao.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitirParaAnalise } from "../src/jobs/analysisWorker.js";

const store = vi.hoisted(() => ({ emitirVerificacao: vi.fn(async () => ({ codigo: "FD-AAAA-BBBB-CCCC" })) }));
vi.mock("../src/services/verificacaoStore.js", () => store);

beforeEach(() => store.emitirVerificacao.mockClear());

describe("emitirParaAnalise", () => {
  it("emite a verificação do laudo recém-concluído", async () => {
    await emitirParaAnalise({ analysisId: "a1", tenantId: "t1", result: { reportId: "FD-1" } });
    // A expectativa repete `substituindo` porque toHaveBeenCalledWith compara
    // o objeto inteiro: omitir a chave faz o teste falhar mesmo com o código
    // certo.
    expect(store.emitirVerificacao).toHaveBeenCalledWith({
      analysisId: "a1",
      tenantId: "t1",
      result: { reportId: "FD-1" },
      substituindo: null,
    });
  });

  it("não derruba a análise quando a emissão falha", async () => {
    // O laudo já está COMPLETED e o crédito já foi cobrado. Deixar a exceção
    // subir cairia no catch que estorna e marca REFUNDED, punindo o cliente
    // por uma falha que não tem nada a ver com a perícia.
    store.emitirVerificacao.mockRejectedValueOnce(new Error("unique violation"));
    await expect(emitirParaAnalise({ analysisId: "a1", tenantId: "t1", result: {} })).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/emissaoVerificacao.test.js
```

Esperado: FAIL com `emitirParaAnalise is not a function`.

- [ ] **Step 3: Implementar**

Em `backend/src/jobs/analysisWorker.js`, acrescentar o import no topo:

```js
import { emitirVerificacao } from "../services/verificacaoStore.js";
```

Acrescentar a função exportada (fora do handler, para poder ser testada sozinha):

```js
/**
 * Emite o registro de verificação pública do laudo.
 *
 * Roda em try/catch PRÓPRIO, pelo mesmo motivo do enriquecimento geográfico
 * logo acima: neste ponto o laudo já está COMPLETED e o crédito já foi
 * cobrado. Deixar a exceção subir cairia no catch do handler, que estorna o
 * crédito e marca REFUNDED, punindo o cliente por uma falha de registro que
 * não afeta o laudo. O backfill (`scripts/backfill-verificacoes.js`) recupera
 * o que ficou para trás.
 */
export async function emitirParaAnalise({ analysisId, tenantId, result, substituindo = null }) {
  try {
    return await emitirVerificacao({ analysisId, tenantId, result, substituindo });
  } catch (erro) {
    console.error(`[AnalysisWorker] Verificação pública não emitida para ${analysisId}:`, erro.message);
    return null;
  }
}
```

Logo depois do `prisma.analysis.update` que grava o `COMPLETED` (por volta da linha 105), acrescentar:

```js
    await emitirParaAnalise({ analysisId, tenantId: job.data.tenantId, result });
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/emissaoVerificacao.test.js
```

Esperado: `Tests  2 passed`.

- [ ] **Step 5: Confirmar que a suíte inteira do backend segue verde**

```bash
cd backend && npx vitest run
```

Esperado: nenhuma falha nova em relação ao baseline de 775 testes.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add backend/src/jobs/analysisWorker.js backend/tests/emissaoVerificacao.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): emitir registro publico ao concluir a analise"
```

---

### Task 5: Substituir a verificação quando o laudo é recalculado

**Files:**
- Modify: `backend/src/controllers/analyzeController.js` (após `recomputeDerived` nas linhas 451 e 691)
- Test: `backend/tests/substituicaoVerificacao.test.js`

**Interfaces:**
- Consumes: `emitirParaAnalise` da Task 4, `prisma.laudoVerification`.
- Produces: `substituirVerificacaoVigente(analysisId, tenantId, result): Promise<registro|null>`, exportada de `backend/src/services/verificacaoStore.js`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/substituicaoVerificacao.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ linhas: [] }));
vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    laudoVerification: {
      findFirst: vi.fn(async ({ where }) =>
        db.linhas.find((l) => l.analysisId === where.analysisId && l.status === where.status) || null
      ),
      create: vi.fn(async ({ data }) => {
        const l = { id: `v${db.linhas.length + 1}`, ...data };
        db.linhas.push(l);
        return l;
      }),
      update: vi.fn(async ({ where, data }) => {
        const l = db.linhas.find((x) => x.id === where.id);
        Object.assign(l, data);
        return l;
      }),
      findUnique: vi.fn(async ({ where }) => db.linhas.find((l) => l.id === where.id) || null),
    },
  },
}));

const { emitirVerificacao, substituirVerificacaoVigente } = await import("../src/services/verificacaoStore.js");

const result = { reportId: "FD-1", generatedAt: "2026-09-19T12:00:00.000Z", hashes: {}, text: "{}" };

beforeEach(() => {
  db.linhas = [];
});

describe("substituirVerificacaoVigente", () => {
  it("aposenta a vigente e emite outra quando o conteúdo mudou", async () => {
    const antiga = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const nova = await substituirVerificacaoVigente("a1", "t1", { ...result, reportId: "FD-2" });

    expect(nova.id).not.toBe(antiga.id);
    expect(db.linhas.find((l) => l.id === antiga.id).status).toBe("SUBSTITUIDO");
  });

  it("não emite nada quando o recálculo não alterou o conteúdo", async () => {
    // reviewAnalysisFields e correctAnalysisGeo recalculam sempre, mesmo quando
    // o usuário confirma o valor que já estava lá. Emitir um laudo novo nesse
    // caso invalidaria um documento que continua correto.
    const antiga = await emitirVerificacao({ analysisId: "a1", tenantId: "t1", result });
    const nova = await substituirVerificacaoVigente("a1", "t1", result);

    expect(nova.id).toBe(antiga.id);
    expect(db.linhas).toHaveLength(1);
  });

  it("emite a primeira verificação para análise antiga que ainda não tem uma", async () => {
    const nova = await substituirVerificacaoVigente("a-antiga", "t1", result);
    expect(nova.status).toBe("VALIDO");
    expect(db.linhas).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/substituicaoVerificacao.test.js
```

Esperado: FAIL com `substituirVerificacaoVigente is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar em `backend/src/services/verificacaoStore.js`:

```js
/**
 * Reemite a verificação depois de o laudo ser recalculado.
 *
 * `recomputeDerived` roda em toda correção de coordenada e de campo, inclusive
 * quando o usuário confirma o valor que já estava lá. Comparar o hash antes de
 * emitir evita invalidar um laudo que continua idêntico: quem tem o documento
 * impresso não deveria ver "substituído" porque alguém abriu a tela de revisão
 * e clicou em salvar sem mudar nada.
 */
export async function substituirVerificacaoVigente(analysisId, tenantId, result) {
  const vigente = await prisma.laudoVerification.findFirst({
    where: { analysisId, status: "VALIDO" },
  });

  const hashNovo = hashDoLaudo(result);
  if (vigente && vigente.laudoHash === hashNovo) return vigente;

  return emitirVerificacao({ analysisId, tenantId, result, substituindo: vigente?.id || null });
}
```

Em `backend/src/controllers/analyzeController.js`, acrescentar o import:

```js
import { substituirVerificacaoVigente } from "../services/verificacaoStore.js";
```

Nos dois pontos em que o resultado corrigido é persistido (depois do `prisma.analysis.update` que sucede `recomputeDerived` nas linhas 451 e 691), acrescentar:

```js
    // O laudo mudou de conteúdo: o que foi impresso antes deixa de valer, e a
    // página pública precisa apontar para a emissão nova.
    await substituirVerificacaoVigente(analysis.id, req.tenantId, corrigido);
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/substituicaoVerificacao.test.js
```

Esperado: `Tests  3 passed`.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add backend/src/services/verificacaoStore.js backend/src/controllers/analyzeController.js backend/tests/substituicaoVerificacao.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): reemitir laudo quando o conteudo e recalculado"
```

---

### Task 6: Rota pública de consulta

**Files:**
- Modify: `backend/src/services/verificacaoStore.js` (`buscarPorChave`)
- Modify: `backend/src/middleware/rateLimiters.js` (fim do arquivo)
- Create: `backend/src/controllers/verificacaoController.js`
- Create: `backend/src/routes/publicRoutes.js`
- Modify: `backend/src/routes/index.js` (após `router.use("/webhooks", webhookRoutes)`)
- Test: `backend/tests/verificacaoController.test.js`

**Interfaces:**
- Consumes: `normalizarChave` (Task 2), `buscarPorChave` (Task 3).
- Produces: `GET /api/public/laudos/:chave`, sem autenticação.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/verificacaoController.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ buscarPorChave: vi.fn() }));
vi.mock("../src/services/verificacaoStore.js", () => store);
vi.mock("../src/utils/prisma.js", () => ({ prisma: { auditLog: { create: vi.fn(async () => ({})) } } }));

const { consultarLaudo } = await import("../src/controllers/verificacaoController.js");

const req = (chave) => ({ params: { chave }, ip: "203.0.113.9", get: () => "vitest" });
const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

const registro = {
  codigo: "FD-7KQ2-9XMR-4TVB",
  laudoHash: "A".repeat(64),
  reportId: "FD-20260919-A1B2C3D4E5",
  status: "VALIDO",
  emitidoEm: new Date("2026-09-19T12:00:00.000Z"),
  tenantId: "t-secreto",
  analysisId: "a-secreto",
  publicSnapshot: {
    titular: { nome: "R***** M******", cpf: "***.456.789-**" },
    documentoAnalisado: { sha256: "ABC", sha1: "DEF" },
    emissor: "ForenseDoc",
  },
  substituidoPor: null,
};

beforeEach(() => store.buscarPorChave.mockReset());

describe("consultarLaudo", () => {
  it("devolve a situação, os hashes e o titular mascarado", async () => {
    store.buscarPorChave.mockResolvedValue(registro);
    const r = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), r);

    expect(r.code).toBe(200);
    expect(r.body.situacao).toBe("VALIDO");
    expect(r.body.laudo.sha256).toBe("A".repeat(64));
    expect(r.body.titular.nome).toBe("R***** M******");
  });

  it("nunca devolve tenantId nem analysisId", async () => {
    store.buscarPorChave.mockResolvedValue(registro);
    const r = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), r);

    expect(JSON.stringify(r.body)).not.toMatch(/t-secreto|a-secreto|tenantId|analysisId/);
  });

  it("aceita o hash como chave", async () => {
    store.buscarPorChave.mockResolvedValue(registro);
    const r = res();
    await consultarLaudo(req("a".repeat(64)), r);

    expect(store.buscarPorChave).toHaveBeenCalledWith({ tipo: "hash", valor: "A".repeat(64) });
  });

  it("aponta o código novo quando o laudo foi substituído", async () => {
    store.buscarPorChave.mockResolvedValue({
      ...registro,
      status: "SUBSTITUIDO",
      substituidoPor: { codigo: "FD-ZZZZ-YYYY-XXXX" },
    });
    const r = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), r);

    expect(r.body.situacao).toBe("SUBSTITUIDO");
    expect(r.body.substituidoPor).toBe("FD-ZZZZ-YYYY-XXXX");
  });

  it("responde o MESMO corpo para chave inexistente e para chave malformada", async () => {
    // A diferença de mensagem confirmaria a existência de um laudo para quem
    // está tentando adivinhar códigos.
    store.buscarPorChave.mockResolvedValue(null);

    const inexistente = res();
    await consultarLaudo(req("FD-7KQ2-9XMR-4TVB"), inexistente);
    const malformada = res();
    await consultarLaudo(req("nao-e-chave"), malformada);

    expect(inexistente.code).toBe(404);
    expect(malformada.code).toBe(404);
    expect(inexistente.body).toEqual(malformada.body);
  });

  it("não consulta o banco quando a chave é malformada", async () => {
    await consultarLaudo(req("nao-e-chave"), res());
    expect(store.buscarPorChave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/verificacaoController.test.js
```

Esperado: FAIL com `Failed to load url ../src/controllers/verificacaoController.js`.

- [ ] **Step 3: Trazer o código da substituta junto na busca**

Em `backend/src/services/verificacaoStore.js`, trocar `buscarPorChave` por:

```js
export async function buscarPorChave({ tipo, valor }) {
  if (!tipo || !valor) return null;
  const where = tipo === "hash" ? { laudoHash: valor } : { codigo: valor };
  return prisma.laudoVerification.findUnique({
    where,
    // Só o código da substituta. Um include aberto traria o registro inteiro
    // da outra linha para dentro de uma rota sem autenticação.
    include: { substituidoPor: { select: { codigo: true } } },
  });
}
```

- [ ] **Step 4: Implementar o controller**

Criar `backend/src/controllers/verificacaoController.js`:

```js
import { normalizarChave } from "../services/laudoVerificacao.js";
import { buscarPorChave } from "../services/verificacaoStore.js";
import { prisma } from "../utils/prisma.js";

/**
 * Consulta pública de autenticidade de laudo.
 *
 * Não exige sessão: quem confere é justamente quem não tem conta aqui, como o
 * juízo, a parte contrária e o titular do dado que aparece no contrato.
 *
 * A resposta é montada campo a campo a partir do snapshot já mascarado. Devolver
 * o registro do Prisma com um spread seria o caminho mais curto para vazar
 * `tenantId` e `analysisId` numa rota aberta no dia em que alguém acrescentasse
 * uma coluna.
 */

const NAO_ENCONTRADO = { error: "Nenhum laudo corresponde a este código ou hash." };

const AVISOS = {
  VALIDO:
    "O que se verifica é o conteúdo do laudo, não o arquivo. Confira se o hash e o titular exibidos aqui coincidem com os impressos no documento em mãos.",
  SUBSTITUIDO:
    "Este laudo era autêntico na data de emissão, mas foi reemitido depois de uma correção. Use o laudo com o código indicado abaixo.",
  CANCELADO: "Este laudo foi cancelado pelo emissor e não deve ser usado.",
  DADOS_REMOVIDOS:
    "Os resumos criptográficos continuam conferindo. Os dados do titular foram eliminados a pedido e não são mais exibidos.",
};

function projetar(v) {
  const resposta = {
    situacao: v.status,
    codigo: v.codigo,
    protocolo: v.reportId,
    emitidoEm: v.emitidoEm,
    laudo: { sha256: v.laudoHash },
    documentoAnalisado: v.publicSnapshot?.documentoAnalisado ?? { sha256: null, sha1: null },
    titular: v.publicSnapshot?.titular ?? { nome: null, cpf: null },
    emissor: v.publicSnapshot?.emissor ?? "ForenseDoc",
    substituidoPor: v.substituidoPor?.codigo ?? null,
    cancelamento:
      v.status === "CANCELADO" ? { em: v.canceladoEm, motivo: v.canceladoMotivo } : null,
    aviso: AVISOS[v.status] || AVISOS.VALIDO,
  };
  return resposta;
}

export async function consultarLaudo(req, res) {
  const chave = normalizarChave(req.params.chave);

  // Chave malformada nem chega ao banco: economiza a consulta e fecha o canal
  // de medição por tempo de resposta.
  if (!chave.tipo) return res.status(404).json(NAO_ENCONTRADO);

  try {
    const registro = await buscarPorChave(chave);
    if (!registro) return res.status(404).json(NAO_ENCONTRADO);

    /*
     * A consulta entra na trilha de auditoria. Serve para dois fins: detectar
     * tentativa de varredura de códigos e atender o piso do Marco Civil
     * (art. 15) de registros de acesso à aplicação. Guarda o código, nunca o
     * hash inteiro, e a retenção de 365 dias do purgeRecords já cobre a linha.
     */
    prisma.auditLog
      .create({
        data: {
          action: "laudo_verification_lookup",
          ipAddress: req.ip,
          userAgent: req.get("user-agent") || null,
          metadata: { codigo: registro.codigo, situacao: registro.status },
        },
      })
      .catch((erro) => console.error("[Verificacao] Falha ao registrar consulta:", erro.message));

    return res.json(projetar(registro));
  } catch (erro) {
    console.error("[Verificacao] Erro ao consultar laudo:", erro);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
```

- [ ] **Step 5: Criar o limitador e a rota**

Acrescentar ao fim de `backend/src/middleware/rateLimiters.js`:

```js
/**
 * Consulta pública de laudo.
 *
 * O código tem 60 bits, então não é enumerável nem sem limite. O limite existe
 * para o outro risco: alguém varrendo a rota para medir tempo de resposta ou
 * para derrubar o banco com consultas de graça, sem precisar de conta.
 */
export const verificacaoLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Muitas consultas. Aguarde um momento." },
  prefix: "rl:verificacao:",
});
```

Criar `backend/src/routes/publicRoutes.js`:

```js
import { Router } from "express";
import { consultarLaudo } from "../controllers/verificacaoController.js";
import { verificacaoLimiter } from "../middleware/rateLimiters.js";

/**
 * Rotas sem autenticação.
 *
 * O prefixo `/public` é literal de propósito: quem ler o roteador tem que ver
 * de imediato que ali dentro nada exige sessão, em vez de descobrir isso
 * conferindo middleware por middleware.
 */
const router = Router();

router.get("/laudos/:chave", verificacaoLimiter, consultarLaudo);

export default router;
```

Em `backend/src/routes/index.js`, acrescentar o import junto aos demais e a montagem logo abaixo de `router.use("/webhooks", webhookRoutes)`:

```js
import publicRoutes from "./publicRoutes.js";
```

```js
// Verificação pública de laudo. Fica ao lado de /auth e /webhooks porque, como
// elas, não passa pelo tenantLimiter: não há tenant no request.
router.use("/public", publicRoutes);
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/verificacaoController.test.js
```

Esperado: `Tests  6 passed`.

- [ ] **Step 7: Conferir a rota no servidor de verdade**

Com o ambiente no ar (`bash start-dev.sh` na raiz de `forensedoc-ForenseDoc`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/api/public/laudos/chave-invalida
curl -s http://localhost:8787/api/public/laudos/FD-7KQ2-9XMR-4TVB
```

Esperado: `404` nas duas, com o corpo `{"error":"Nenhum laudo corresponde a este código ou hash."}`, e sem exigir `Authorization`.

- [ ] **Step 8: Commit**

```bash
/opt/homebrew/bin/git add backend/src/controllers/verificacaoController.js backend/src/routes/publicRoutes.js backend/src/routes/index.js backend/src/middleware/rateLimiters.js backend/src/services/verificacaoStore.js backend/tests/verificacaoController.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): rota publica de consulta de laudo"
```

---

### Task 7: QR Code e bloco de verificação no PDF

**Files:**
- Create: `backend/src/reports/qrVerificacao.js`
- Test: `backend/tests/qrVerificacao.test.js`
- Modify: `backend/src/services/reportPdfService.js` (seção de identificação, por volta da linha 444)
- Modify: `backend/src/controllers/analyzeController.js` (`getAnalysisPdf`, por volta da linha 300)
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: `qrcode-svg` (já é dependência, usada em `totpController.js`).
- Produces: `desenharQr(doc, { conteudo, x, y, lado })`, `urlDeVerificacao(codigo): string`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/qrVerificacao.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { desenharQr, urlDeVerificacao } from "../src/reports/qrVerificacao.js";

describe("urlDeVerificacao", () => {
  const original = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = "https://forensedoc.com.br/";
  });
  afterEach(() => {
    process.env.FRONTEND_URL = original;
  });

  it("monta a URL sem barra dupla", () => {
    expect(urlDeVerificacao("FD-7KQ2-9XMR-4TVB")).toBe(
      "https://forensedoc.com.br/verificar/FD-7KQ2-9XMR-4TVB"
    );
  });

  it("cai no host local quando a variável não está definida", () => {
    delete process.env.FRONTEND_URL;
    expect(urlDeVerificacao("FD-A")).toBe("http://localhost:5173/verificar/FD-A");
  });
});

describe("desenharQr", () => {
  function docFalso() {
    const chamadas = { rect: 0, fill: 0, save: 0, restore: 0 };
    const doc = {
      save: () => (chamadas.save++, doc),
      restore: () => (chamadas.restore++, doc),
      rect: () => (chamadas.rect++, doc),
      fill: () => (chamadas.fill++, doc),
      chamadas,
    };
    return doc;
  }

  it("desenha um retângulo por módulo preenchido", () => {
    const doc = docFalso();
    desenharQr(doc, { conteudo: "https://forensedoc.com.br/verificar/FD-A", x: 10, y: 20, lado: 90 });
    // 1 retângulo do fundo branco + 1 por módulo escuro.
    expect(doc.chamadas.rect).toBeGreaterThan(100);
    expect(doc.chamadas.save).toBe(1);
    expect(doc.chamadas.restore).toBe(1);
  });

  it("devolve o lado efetivo, para quem chama posicionar a legenda abaixo", () => {
    const doc = docFalso();
    const { lado } = desenharQr(doc, { conteudo: "x", x: 0, y: 0, lado: 90 });
    expect(lado).toBeLessThanOrEqual(90);
    expect(lado).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/qrVerificacao.test.js
```

Esperado: FAIL com `Failed to load url ../src/reports/qrVerificacao.js`.

- [ ] **Step 3: Implementar**

Criar `backend/src/reports/qrVerificacao.js`:

```js
import QRCode from "qrcode-svg";

/**
 * QR Code de verificação, desenhado direto no PDF.
 *
 * ─── Por que retângulo a retângulo e não uma imagem ──────────────────────────
 *
 * O PDFKit não renderiza SVG, e converter para PNG exigiria uma dependência de
 * rasterização só para isto. A `qrcode-svg`, que já entrou no projeto para o
 * QR do segundo fator, expõe a matriz de módulos em `qrcode.modules`. Desenhar
 * a matriz com `doc.rect().fill()` dá saída vetorial, imprime nítido em
 * qualquer resolução e não acrescenta nada ao `package.json`.
 *
 * A correção de erro fica em M (15%): o laudo é impresso, grampeado e
 * fotocopiado, e o nível L não sobrevive a uma cópia ruim. Acima de M o código
 * fica denso demais para o espaço disponível no rodapé.
 */

const CORRECAO_DE_ERRO = "M";

export function urlDeVerificacao(codigo) {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/verificar/${codigo}`;
}

/**
 * @param {PDFDocument} doc
 * @param {object} params
 * @param {string} params.conteudo  texto embutido no QR
 * @param {number} params.x         canto superior esquerdo, em pontos
 * @param {number} params.y
 * @param {number} params.lado      lado máximo desejado, em pontos
 * @returns {{ lado: number }} lado efetivo, múltiplo inteiro do módulo
 */
export function desenharQr(doc, { conteudo, x, y, lado }) {
  const matriz = new QRCode({ content: conteudo, padding: 0, ecl: CORRECAO_DE_ERRO }).qrcode.modules;
  const n = matriz.length;

  // O módulo é arredondado para baixo: um módulo fracionário faz a impressora
  // distribuir o resto de forma irregular e alguns leitores perdem o código.
  const modulo = Math.floor((lado / n) * 100) / 100;
  const ladoEfetivo = modulo * n;

  doc.save();
  // Fundo branco explícito. O QR pode cair sobre uma faixa de cor do tema, e
  // leitor nenhum decodifica módulo escuro sobre fundo escuro.
  doc.rect(x, y, ladoEfetivo, ladoEfetivo).fill("#ffffff");

  for (let linha = 0; linha < n; linha++) {
    for (let coluna = 0; coluna < n; coluna++) {
      if (!matriz[linha][coluna]) continue;
      doc.rect(x + coluna * modulo, y + linha * modulo, modulo, modulo).fill("#000000");
    }
  }
  doc.restore();

  return { lado: ladoEfetivo };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/qrVerificacao.test.js
```

Esperado: `Tests  4 passed`.

- [ ] **Step 5: Passar a verificação para o gerador de PDF**

Em `backend/src/controllers/analyzeController.js`, dentro de `getAnalysisPdf`, carregar a verificação vigente e repassá-la:

```js
    const verificacao = await prisma.laudoVerification.findFirst({
      where: { analysisId: analysis.id, status: "VALIDO" },
      select: { codigo: true, laudoHash: true },
    });
    const pdf = await buildReportPdf(analysis, analysis.result, { verificacao });
```

- [ ] **Step 6: Imprimir o bloco no laudo**

Em `backend/src/services/reportPdfService.js`, receber a opção na assinatura de `buildReportPdf` (junto de `tema`) e, na seção de identificação (logo depois de `field(ctx, "Identificador do laudo", ...)`, por volta da linha 444), acrescentar:

```js
  if (verificacao) {
    field(ctx, "Código de verificação", verificacao.codigo, { mono: true });
    field(ctx, "SHA-256 deste laudo", verificacao.laudoHash, { mono: true });

    const LADO_QR = 88;
    const { lado } = desenharQr(doc, {
      conteudo: urlDeVerificacao(verificacao.codigo),
      x: doc.page.width - MARGIN - LADO_QR,
      y: doc.y + 6,
      lado: LADO_QR,
    });

    doc.fontSize(7).fillColor("#52525b");
    doc.text("Confira a autenticidade", doc.page.width - MARGIN - lado, doc.y + lado + 10, {
      width: lado,
      align: "center",
    });

    paragraph(
      ctx,
      "O código acima confere o CONTEÚDO do laudo, não o arquivo. O PDF é remontado a cada download e seus bytes mudam a cada geração, o que tornaria o resumo do arquivo inútil como prova de integridade.",
      { size: 8 }
    );
  }
```

E o import no topo do arquivo:

```js
import { desenharQr, urlDeVerificacao } from "../reports/qrVerificacao.js";
```

- [ ] **Step 7: Documentar a variável de ambiente**

Em `backend/.env.example`, junto da linha `FRONTEND_URL=http://localhost:5173`, acrescentar o comentário:

```
# Também é a base do QR Code impresso em cada laudo. Em produção precisa ser a
# URL pública real: um laudo impresso com localhost tem QR que não abre em
# lugar nenhum, e o laudo já está com o cliente quando alguém percebe.
```

- [ ] **Step 8: Gerar um PDF de verdade e olhar o resultado**

```bash
cd backend && DATABASE_URL="postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev" node scripts/gerarLaudoTeste.mjs
```

Abrir o PDF gerado, apontar a câmera do celular para o QR e confirmar que ele abre `/verificar/FD-...`. Um QR que não decodifica é falha de tarefa, não detalhe de acabamento.

- [ ] **Step 9: Commit**

```bash
/opt/homebrew/bin/git add backend/src/reports/qrVerificacao.js backend/tests/qrVerificacao.test.js backend/src/services/reportPdfService.js backend/src/controllers/analyzeController.js backend/.env.example
/opt/homebrew/bin/git commit -m "feat(verificacao): QR code e bloco de verificacao no laudo"
```

---

### Task 8: Página pública de verificação

**Files:**
- Create: `frontend/src/pages/VerificarLaudo.jsx`
- Test: `frontend/src/tests/verificarLaudo.test.jsx`
- Modify: `frontend/src/App.jsx` (bloco de rotas públicas, junto de `/termos` e `/privacidade`)

**Interfaces:**
- Consumes: `GET /api/public/laudos/:chave` da Task 6.
- Produces: rotas `/verificar` e `/verificar/:chave`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `frontend/src/tests/verificarLaudo.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/axios", () => ({ api: http }));

const { default: VerificarLaudo } = await import("../pages/VerificarLaudo.jsx");

const renderizar = (rota = "/verificar") =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path="/verificar" element={<VerificarLaudo />} />
        <Route path="/verificar/:chave" element={<VerificarLaudo />} />
      </Routes>
    </MemoryRouter>
  );

const valido = {
  data: {
    situacao: "VALIDO",
    codigo: "FD-7KQ2-9XMR-4TVB",
    protocolo: "FD-20260919-A1B2C3D4E5",
    emitidoEm: "2026-09-19T12:00:00.000Z",
    laudo: { sha256: "A".repeat(64) },
    documentoAnalisado: { sha256: "B".repeat(64), sha1: "C".repeat(40) },
    titular: { nome: "R***** M******", cpf: "***.456.789-**" },
    emissor: "ForenseDoc",
    substituidoPor: null,
    cancelamento: null,
    aviso: "O que se verifica é o conteúdo do laudo, não o arquivo.",
  },
};

beforeEach(() => http.get.mockReset());

describe("VerificarLaudo", () => {
  it("consulta sozinha quando a chave vem na URL do QR", async () => {
    http.get.mockResolvedValue(valido);
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/public/laudos/FD-7KQ2-9XMR-4TVB"));
    expect(await screen.findByText(/laudo aut[êe]ntico/i)).toBeInTheDocument();
  });

  it("mostra os hashes por inteiro, que é o que se compara com o papel", async () => {
    http.get.mockResolvedValue(valido);
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    expect(await screen.findByText("A".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("B".repeat(64))).toBeInTheDocument();
  });

  it("mostra o titular mascarado e explica por quê", async () => {
    http.get.mockResolvedValue(valido);
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    expect(await screen.findByText("R***** M******")).toBeInTheDocument();
    expect(screen.getByText(/parcialmente ocultos/i)).toBeInTheDocument();
  });

  it("busca pelo hash colado no formulário", async () => {
    http.get.mockResolvedValue(valido);
    renderizar();

    fireEvent.change(screen.getByLabelText(/c[óo]digo ou hash/i), { target: { value: "  " + "a".repeat(64) + " " } });
    fireEvent.click(screen.getByRole("button", { name: /verificar/i }));

    await waitFor(() => expect(http.get).toHaveBeenCalledWith(`/public/laudos/${"a".repeat(64)}`));
  });

  it("diz que não encontrou sem sugerir que a chave existe", async () => {
    http.get.mockRejectedValue({ response: { status: 404 } });
    renderizar("/verificar/FD-0000-0000-0000");

    expect(await screen.findByText(/nenhum laudo/i)).toBeInTheDocument();
  });

  it("aponta o laudo novo quando este foi substituído", async () => {
    http.get.mockResolvedValue({
      data: { ...valido.data, situacao: "SUBSTITUIDO", substituidoPor: "FD-ZZZZ-YYYY-XXXX" },
    });
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    expect(await screen.findByText(/substitu[íi]do/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /FD-ZZZZ-YYYY-XXXX/ })).toHaveAttribute(
      "href",
      "/verificar/FD-ZZZZ-YYYY-XXXX"
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd frontend && npx vitest run src/tests/verificarLaudo.test.jsx
```

Esperado: FAIL com `Failed to resolve import "../pages/VerificarLaudo.jsx"`.

- [ ] **Step 3: Implementar**

Criar `frontend/src/pages/VerificarLaudo.jsx`:

```jsx
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ShieldCheck, ShieldAlert, ShieldX, EyeOff, Search, Loader2, ArrowLeft } from "lucide-react";
import { api } from "../lib/axios";
import { cn } from "../utils/cn";
import logoImg from "../assets/logo.png";

/**
 * Verificação pública de autenticidade de laudo.
 *
 * Página aberta, sem sessão: quem confere um laudo é justamente quem não tem
 * conta aqui, como o juízo, a parte contrária e o titular do dado que aparece
 * no contrato analisado.
 *
 * Chega-se aqui de duas formas: pelo QR impresso no laudo, que traz a chave na
 * URL e dispensa digitação, ou pelo formulário, colando o hash que está no
 * corpo do documento. As duas terminam na mesma tela.
 */

const SITUACOES = {
  VALIDO: {
    titulo: "Laudo autêntico",
    Icone: ShieldCheck,
    cor: "text-emerald-500",
    borda: "border-emerald-500/30",
    fundo: "bg-emerald-500/[0.06]",
  },
  SUBSTITUIDO: {
    titulo: "Laudo substituído",
    Icone: ShieldAlert,
    cor: "text-amber-500",
    borda: "border-amber-500/30",
    fundo: "bg-amber-500/[0.06]",
  },
  CANCELADO: {
    titulo: "Laudo cancelado",
    Icone: ShieldX,
    cor: "text-red-500",
    borda: "border-red-500/30",
    fundo: "bg-red-500/[0.06]",
  },
  DADOS_REMOVIDOS: {
    titulo: "Laudo autêntico, dados removidos",
    Icone: EyeOff,
    cor: "text-zinc-300",
    borda: "border-surface-border",
    fundo: "bg-surface/40",
  },
};

function Campo({ rotulo, valor, mono = false }) {
  if (!valor) return null;
  return (
    <div className="border-b border-surface-border/60 py-3 last:border-b-0">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{rotulo}</div>
      <div className={cn("mt-1 break-all text-[13px] text-foreground", mono && "font-mono text-[12px]")}>
        {valor}
      </div>
    </div>
  );
}

export default function VerificarLaudo() {
  const { chave } = useParams();
  const navigate = useNavigate();
  const [entrada, setEntrada] = useState(chave || "");
  const [estado, setEstado] = useState(chave ? "carregando" : "ocioso");
  const [dados, setDados] = useState(null);

  const consultar = useCallback(async (valor) => {
    setEstado("carregando");
    try {
      const { data } = await api.get(`/public/laudos/${encodeURIComponent(valor)}`);
      setDados(data);
      setEstado("achado");
    } catch (erro) {
      setDados(null);
      setEstado(erro?.response?.status === 404 ? "ausente" : "erro");
    }
  }, []);

  useEffect(() => {
    if (chave) consultar(chave);
  }, [chave, consultar]);

  const enviar = (e) => {
    e.preventDefault();
    const valor = entrada.trim();
    if (!valor) return;
    // A URL passa a carregar a chave para que o resultado seja compartilhável
    // e sobreviva a um recarregamento da página.
    navigate(`/verificar/${encodeURIComponent(valor)}`);
  };

  const s = dados ? SITUACOES[dados.situacao] || SITUACOES.VALIDO : null;

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <img src={logoImg} alt="ForenseDoc" className="h-6 w-auto object-contain" />
        </Link>

        <h1 className="text-2xl font-bold text-foreground">Verificar autenticidade de laudo</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Informe o código de verificação impresso no laudo (formato FD-0000-0000-0000) ou o resumo
          SHA-256 do laudo. A consulta é pública e não exige cadastro.
        </p>

        <form onSubmit={enviar} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="chave" className="sr-only">
            Código ou hash do laudo
          </label>
          <input
            id="chave"
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="FD-0000-0000-0000"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-3 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <Search className="h-4 w-4" />
            Verificar
          </button>
        </form>

        {estado === "carregando" && (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {estado === "ausente" && (
          <div className="mt-8 rounded-xl border border-surface-border bg-surface/40 p-6">
            <p className="text-sm text-zinc-300">
              Nenhum laudo corresponde a este código ou hash.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
              Confira se a chave foi copiada por inteiro. O código tem o formato FD-0000-0000-0000 e
              o resumo SHA-256 tem 64 caracteres.
            </p>
          </div>
        )}

        {estado === "erro" && (
          <div className="mt-8 rounded-xl border border-surface-border bg-surface/40 p-6">
            <p className="text-sm text-zinc-300">
              Não foi possível consultar agora. Tente novamente em alguns instantes.
            </p>
          </div>
        )}

        {estado === "achado" && dados && (
          <div className="mt-8 space-y-4">
            <div className={cn("flex items-start gap-3 rounded-xl border p-5", s.borda, s.fundo)}>
              <s.Icone className={cn("mt-0.5 h-6 w-6 shrink-0", s.cor)} />
              <div>
                <h2 className={cn("text-lg font-bold", s.cor)}>{s.titulo}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{dados.aviso}</p>
                {dados.substituidoPor && (
                  <p className="mt-3 text-[13px] text-zinc-300">
                    Laudo vigente:{" "}
                    <Link
                      to={`/verificar/${dados.substituidoPor}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {dados.substituidoPor}
                    </Link>
                  </p>
                )}
                {dados.cancelamento?.motivo && (
                  <p className="mt-3 text-[13px] text-zinc-300">
                    Motivo informado pelo emissor: {dados.cancelamento.motivo}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-surface-border bg-surface/40 p-5">
              <Campo rotulo="Código de verificação" valor={dados.codigo} mono />
              <Campo rotulo="Protocolo do laudo" valor={dados.protocolo} mono />
              <Campo
                rotulo="Emitido em"
                valor={new Date(dados.emitidoEm).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })}
              />
              <Campo rotulo="Emissor" valor={dados.emissor} />
              <Campo rotulo="SHA-256 do laudo" valor={dados.laudo?.sha256} mono />
              <Campo rotulo="SHA-256 do documento analisado" valor={dados.documentoAnalisado?.sha256} mono />
              <Campo rotulo="SHA-1 do documento analisado" valor={dados.documentoAnalisado?.sha1} mono />
              <Campo rotulo="Titular" valor={dados.titular?.nome} />
              <Campo rotulo="CPF do titular" valor={dados.titular?.cpf} mono />
            </div>

            <p className="text-[12px] leading-relaxed text-zinc-500">
              Nome e CPF aparecem parcialmente ocultos porque esta página é pública e o titular do
              dado não é cliente do ForenseDoc. O que está visível basta para confirmar que o laudo
              em mãos é o mesmo registrado aqui, sem revelar a identidade a quem não a conhece
              (LGPD, art. 6º, III).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Registrar as rotas**

Em `frontend/src/App.jsx`, junto das demais rotas públicas:

```jsx
import VerificarLaudo from "./pages/VerificarLaudo.jsx";
```

```jsx
        {/* Verificação de laudo. Pública pelo mesmo motivo das páginas
            jurídicas: quem confere autenticidade não tem conta aqui. A rota
            com parâmetro é o destino do QR impresso no PDF. */}
        <Route path="/verificar" element={<VerificarLaudo />} />
        <Route path="/verificar/:chave" element={<VerificarLaudo />} />
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
cd frontend && npx vitest run src/tests/verificarLaudo.test.jsx
```

Esperado: `Tests  6 passed`.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/pages/VerificarLaudo.jsx frontend/src/tests/verificarLaudo.test.jsx frontend/src/App.jsx
/opt/homebrew/bin/git commit -m "feat(verificacao): pagina publica de verificacao de laudo"
```

---

### Task 9: Entradas para a verificação na página inicial

**Files:**
- Modify: `frontend/src/components/Layout/Header.jsx` (nav de desktop e menu mobile)
- Modify: `frontend/src/pages/Landing.jsx` (rodapé)
- Test: `frontend/src/tests/landing.verificacao.test.jsx`

**Interfaces:**
- Consumes: rota `/verificar` da Task 8.
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Escrever o teste que falha**

Criar `frontend/src/tests/landing.verificacao.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import Header from "../components/Layout/Header.jsx";
import Landing from "../pages/Landing.jsx";

const renderizar = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Entrada para a verificação de laudo", () => {
  it("está no topo da página inicial", () => {
    renderizar(<Header />);
    expect(screen.getByRole("link", { name: /verificar laudo/i })).toHaveAttribute("href", "/verificar");
  });

  it("está também no rodapé, que é onde se procura o que não é venda", () => {
    renderizar(<Landing />);
    expect(screen.getByRole("link", { name: /verificar laudo/i })).toHaveAttribute("href", "/verificar");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd frontend && npx vitest run src/tests/landing.verificacao.test.jsx
```

Esperado: FAIL com `Unable to find an accessible element with the role "link" and name /verificar laudo/i`.

- [ ] **Step 3: Implementar no Header**

Em `frontend/src/components/Layout/Header.jsx`, acrescentar ao fim da nav de desktop (depois do link "Planos"):

```jsx
          {/* Quem chega para conferir um laudo não é visitante de vendas: em
              geral recebeu o documento de outra pessoa e quer saber se é
              legítimo. Precisa achar a entrada sem rolar a página. */}
          <Link to="/verificar" className="text-sm font-medium text-zinc-400 hover:text-foreground transition-colors">
            Verificar laudo
          </Link>
```

E no menu mobile, depois do link "Planos":

```jsx
          <Link to="/verificar" className="text-sm font-medium text-zinc-400 p-2 rounded hover:bg-surface">
            Verificar laudo
          </Link>
```

- [ ] **Step 4: Implementar no rodapé da Landing**

No rodapé de `frontend/src/pages/Landing.jsx`, junto dos links de Termos e Privacidade:

```jsx
              <Link to="/verificar" className="transition-colors hover:text-zinc-300">
                Verificar laudo
              </Link>
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
cd frontend && npx vitest run src/tests/landing.verificacao.test.jsx
```

Esperado: `Tests  2 passed`.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/components/Layout/Header.jsx frontend/src/pages/Landing.jsx frontend/src/tests/landing.verificacao.test.jsx
/opt/homebrew/bin/git commit -m "feat(verificacao): entradas para a verificacao na pagina inicial"
```

---

### Task 10: Backfill dos laudos já emitidos

**Files:**
- Create: `backend/scripts/backfill-verificacoes.js`
- Test: `backend/tests/backfillVerificacoes.test.js`

**Interfaces:**
- Consumes: `emitirVerificacao` (Task 3), `hashDoLaudo` (Task 2).
- Produces: `backfillVerificacoes({ lote, seco }): Promise<{ criadas, puladas, falhas }>`.

Sem esta tarefa, todo laudo emitido antes do deploy responde "não encontrado" na página pública, e o cliente que baixar de novo um laudo antigo recebe um PDF sem QR.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/backfillVerificacoes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ analises: [], verificacoes: [] }));
vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    analysis: { findMany: vi.fn(async () => db.analises) },
    laudoVerification: {
      findFirst: vi.fn(async ({ where }) => db.verificacoes.find((v) => v.analysisId === where.analysisId) || null),
      create: vi.fn(async ({ data }) => {
        const v = { id: `v${db.verificacoes.length + 1}`, ...data };
        db.verificacoes.push(v);
        return v;
      }),
    },
  },
}));

const { backfillVerificacoes } = await import("../scripts/backfill-verificacoes.js");

const analise = (id) => ({
  id,
  tenantId: "t1",
  result: { reportId: `FD-${id}`, generatedAt: "2026-09-19T12:00:00.000Z", hashes: { sha256: "AA" }, text: "{}" },
});

beforeEach(() => {
  db.analises = [];
  db.verificacoes = [];
});

describe("backfillVerificacoes", () => {
  it("cria verificação para laudo que ainda não tem", async () => {
    db.analises = [analise("a1"), analise("a2")];
    expect(await backfillVerificacoes({})).toEqual({ criadas: 2, puladas: 0, falhas: 0 });
  });

  it("é idempotente: rodar de novo não duplica", async () => {
    db.analises = [analise("a1")];
    await backfillVerificacoes({});
    expect(await backfillVerificacoes({})).toEqual({ criadas: 0, puladas: 1, falhas: 0 });
    expect(db.verificacoes).toHaveLength(1);
  });

  it("no modo seco não escreve nada", async () => {
    db.analises = [analise("a1")];
    const r = await backfillVerificacoes({ seco: true });
    expect(r.criadas).toBe(1);
    expect(db.verificacoes).toHaveLength(0);
  });

  it("uma falha não interrompe o lote", async () => {
    db.analises = [{ id: "quebrada", tenantId: "t1", result: null }, analise("a2")];
    const r = await backfillVerificacoes({});
    expect(r.criadas).toBe(1);
    expect(r.falhas).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/backfillVerificacoes.test.js
```

Esperado: FAIL com `Failed to load url ../scripts/backfill-verificacoes.js`.

- [ ] **Step 3: Implementar**

Criar `backend/scripts/backfill-verificacoes.js`:

```js
import "dotenv/config";
import { prisma } from "../src/utils/prisma.js";
import { emitirVerificacao } from "../src/services/verificacaoStore.js";

/**
 * Cria o registro de verificação dos laudos emitidos antes desta funcionalidade.
 *
 * Sem isso, todo laudo anterior ao deploy responde "não encontrado" na página
 * pública, e o cliente que baixar de novo um laudo antigo recebe um PDF sem QR.
 *
 * É idempotente de propósito: a rotina vai ser rodada mais de uma vez, porque a
 * primeira execução em produção costuma ser interrompida por timeout de
 * conexão no meio da base.
 *
 * Uso:
 *   node scripts/backfill-verificacoes.js --seco     # só conta, não escreve
 *   node scripts/backfill-verificacoes.js
 */

export async function backfillVerificacoes({ lote = 200, seco = false } = {}) {
  const resumo = { criadas: 0, puladas: 0, falhas: 0 };

  const analises = await prisma.analysis.findMany({
    where: { status: "COMPLETED", result: { not: null } },
    select: { id: true, tenantId: true, result: true },
    orderBy: { createdAt: "asc" },
    take: lote,
  });

  for (const analise of analises) {
    try {
      const existente = await prisma.laudoVerification.findFirst({ where: { analysisId: analise.id } });
      if (existente) {
        resumo.puladas++;
        continue;
      }
      if (!analise.result) throw new Error("análise COMPLETED sem result");

      if (!seco) {
        await emitirVerificacao({ analysisId: analise.id, tenantId: analise.tenantId, result: analise.result });
      }
      resumo.criadas++;
    } catch (erro) {
      resumo.falhas++;
      console.error(`[Backfill] ${analise.id}: ${erro.message}`);
    }
  }

  return resumo;
}

// Só executa quando chamado direto, para o teste poder importar sem disparar.
if (process.argv[1]?.endsWith("backfill-verificacoes.js")) {
  const seco = process.argv.includes("--seco");
  const resumo = await backfillVerificacoes({ lote: 100000, seco });
  console.log(`[Backfill] criadas: ${resumo.criadas}, puladas: ${resumo.puladas}, falhas: ${resumo.falhas}`);
  if (seco) console.log("[Backfill] modo seco: nada foi gravado.");
  await prisma.$disconnect();
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/backfillVerificacoes.test.js
```

Esperado: `Tests  4 passed`.

- [ ] **Step 5: Rodar o modo seco no banco local**

```bash
cd backend && DATABASE_URL="postgresql://forensedoc:forensedoc_dev@localhost:55432/forensedoc_dev" node scripts/backfill-verificacoes.js --seco
```

Esperado: uma linha de resumo e a confirmação de que nada foi gravado.

- [ ] **Step 6: Commit**

```bash
/opt/homebrew/bin/git add backend/scripts/backfill-verificacoes.js backend/tests/backfillVerificacoes.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): backfill dos laudos emitidos antes da funcionalidade"
```

---

### Task 11: Cancelamento de laudo pelo operador

**Files:**
- Modify: `backend/src/controllers/adminController.js` (fim do arquivo)
- Modify: `backend/src/routes/adminRoutes.js` (junto das rotas de tenant)
- Test: `backend/tests/cancelarLaudo.test.js`

**Interfaces:**
- Consumes: `cancelarVerificacao` da Task 3.
- Produces: `POST /api/admin/laudos/:codigo/cancelar`, corpo `{ motivo: string }`.

Um laudo emitido sobre o arquivo errado precisa de um caminho para deixar de se apresentar como válido. Sem isto, a única saída seria editar o banco à mão.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/tests/cancelarLaudo.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ cancelarVerificacao: vi.fn() }));
vi.mock("../src/services/verificacaoStore.js", () => store);
vi.mock("../src/utils/prisma.js", () => ({ prisma: { auditLog: { create: vi.fn(async () => ({})) } } }));
// adminController importa estes dois no topo. Sem os mocks, o import do
// controller puxa o serviço de crédito e o de notificação inteiros para dentro
// do teste, junto das conexões que eles abrem.
vi.mock("../src/services/creditService.js", () => ({ addManualCredits: vi.fn(), invalidateCreditCache: vi.fn() }));
vi.mock("../src/services/notificationService.js", () => ({ notify: vi.fn() }));

const { cancelarLaudo } = await import("../src/controllers/adminController.js");

const res = () => {
  const r = { code: 200, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const req = (codigo, motivo) => ({
  params: { codigo },
  body: { motivo },
  auth: { userId: "u1" },
  ip: "203.0.113.9",
  get: () => "vitest",
});

beforeEach(() => store.cancelarVerificacao.mockReset());

describe("cancelarLaudo", () => {
  it("exige motivo: um laudo cancelado sem justificativa é pior que um laudo válido", async () => {
    const r = res();
    await cancelarLaudo(req("FD-7KQ2-9XMR-4TVB", "  "), r);
    expect(r.code).toBe(400);
    expect(store.cancelarVerificacao).not.toHaveBeenCalled();
  });

  it("cancela e devolve a situação nova", async () => {
    store.cancelarVerificacao.mockResolvedValue({ codigo: "FD-7KQ2-9XMR-4TVB", status: "CANCELADO" });
    const r = res();
    await cancelarLaudo(req("FD-7KQ2-9XMR-4TVB", "emitido sobre arquivo errado"), r);

    expect(store.cancelarVerificacao).toHaveBeenCalledWith("FD-7KQ2-9XMR-4TVB", "emitido sobre arquivo errado");
    expect(r.body.situacao).toBe("CANCELADO");
  });

  it("devolve 404 quando o código não existe", async () => {
    store.cancelarVerificacao.mockRejectedValue({ code: "P2025" });
    const r = res();
    await cancelarLaudo(req("FD-0000-0000-0000", "motivo"), r);
    expect(r.code).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && npx vitest run tests/cancelarLaudo.test.js
```

Esperado: FAIL com `cancelarLaudo is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar o import junto aos demais, no TOPO de `backend/src/controllers/adminController.js` (o arquivo já importa `prisma` na linha 3, que o handler reaproveita):

```js
import { cancelarVerificacao } from "../services/verificacaoStore.js";
```

E o handler ao fim do arquivo:

```js
/**
 * Cancela a validade pública de um laudo.
 *
 * Existe para o caso de emissão sobre o arquivo errado. O motivo é obrigatório
 * porque ele aparece na página pública: um laudo que passa a dizer "cancelado"
 * sem explicar por quê lança dúvida sobre o trabalho inteiro, e quem recebeu o
 * documento não tem a quem perguntar.
 *
 * O cancelamento não apaga nada. O registro continua confirmando que o laudo
 * foi emitido e que o hash confere, o que é exatamente o que precisa continuar
 * verdadeiro para quem já recebeu o documento.
 */
export async function cancelarLaudo(req, res) {
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) {
    return res.status(400).json({ error: "Informe o motivo do cancelamento." });
  }

  try {
    const cancelado = await cancelarVerificacao(req.params.codigo, motivo);

    await prisma.auditLog.create({
      data: {
        action: "laudo_cancelled",
        userId: req.auth.userId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null,
        metadata: { codigo: req.params.codigo, motivo },
      },
    });

    return res.json({ codigo: cancelado.codigo, situacao: cancelado.status });
  } catch (erro) {
    if (erro.code === "P2025") {
      return res.status(404).json({ error: "Laudo não encontrado." });
    }
    console.error("[Admin] Erro ao cancelar laudo:", erro);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
```

Em `backend/src/routes/adminRoutes.js`, acrescentar `cancelarLaudo` ao import de `adminController.js` e a rota junto das de tenant:

```js
// Cancelamento de laudo. Fica sob /admin, e não sob o tenant, porque desfazer
// a validade pública de um documento já entregue é poder de plataforma.
router.post("/laudos/:codigo/cancelar", cancelarLaudo);
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && npx vitest run tests/cancelarLaudo.test.js
```

Esperado: `Tests  3 passed`.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add backend/src/controllers/adminController.js backend/src/routes/adminRoutes.js backend/tests/cancelarLaudo.test.js
/opt/homebrew/bin/git commit -m "feat(verificacao): cancelamento de laudo pelo operador da plataforma"
```

---

### Task 12: Declarar o novo tratamento na Política de Privacidade

**Files:**
- Modify: `frontend/src/pages/legal/Privacidade.jsx`
- Test: `frontend/src/tests/legal.test.jsx` (acrescentar casos ao bloco existente de Política de Privacidade)

**Interfaces:**
- Consumes: nada.
- Produces: nada que outra tarefa consuma.

A página pública é tratamento novo de dado pessoal, com nova finalidade e nova forma de disponibilização. O documento diz, no próprio cabeçalho do arquivo, que os prazos e os tratamentos descritos ali são os que o sistema realmente aplica. Publicar a verificação sem atualizá-lo transformaria a política em prova documental contra quem a publicou.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao bloco `describe("Política de Privacidade", ...)` em `frontend/src/tests/legal.test.jsx`:

```jsx
  it("declara a página pública de verificação de laudo", () => {
    renderizar(<Privacidade />);
    expect(screen.getByText(/verifica(ç|c)ão p(ú|u)blica de laudo/i)).toBeInTheDocument();
  });

  it("explica que o titular aparece de forma parcial e por quê", () => {
    renderizar(<Privacidade />);
    expect(screen.getByText(/parcialmente ocultos/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd frontend && npx vitest run src/tests/legal.test.jsx
```

Esperado: FAIL nos dois casos novos, com `Unable to find an element with the text`.

- [ ] **Step 3: Implementar**

A página hoje vai até a seção 9 ("Alterações"). A seção nova entra como **8**, logo depois de "Seus direitos" (linha 204) e antes de "Cookies" (linha 234), porque descreve um direito e uma exposição de dado, não um detalhe operacional. Renumerar "Cookies" para 9 e "Alterações" para 10, que é a ordem convencional (alterações por último).

Acrescentar em `frontend/src/pages/legal/Privacidade.jsx`, usando o componente `Secao` já existente no arquivo:

```jsx
      <Secao numero="8" titulo="Verificação pública de laudo">
        <p>
          Cada laudo emitido recebe um código de verificação e um resumo criptográfico SHA-256 do
          seu conteúdo, impressos no documento junto de um QR Code. Qualquer pessoa pode consultar
          esse código em nossa página de verificação, sem cadastro, para confirmar que o laudo em
          mãos foi realmente emitido por nós e não foi alterado.
        </p>
        <p>
          A consulta exibe a situação do laudo, a data de emissão, os resumos criptográficos e o
          nome e o CPF do titular <strong>parcialmente ocultos</strong>. O mascaramento é aplicado
          no momento da emissão e gravado assim: a página não tem acesso ao dado completo. Exibimos
          o mínimo necessário para que quem já tem o laudo confirme que se trata do mesmo documento,
          sem revelar a identidade a quem não a conhece (art. 6º, III).
        </p>
        <p>
          O código de verificação tem entropia suficiente para não ser adivinhado, e a consulta é
          limitada por origem. Registramos cada consulta em nossa trilha de auditoria, com o
          endereço IP, pelo prazo de 12 meses, para identificar tentativas de varredura.
        </p>
        <p>
          Atendido o pedido de eliminação do titular, os dados pessoais saem do registro de
          verificação e a página passa a exibir apenas os resumos criptográficos e a confirmação de
          que o laudo foi emitido. Os resumos permanecem porque não identificam ninguém isoladamente
          e são o que permite a quem recebeu o documento continuar conferindo sua integridade.
        </p>
      </Secao>
```

Em seguida trocar `<Secao numero="8" titulo="Cookies">` por `numero="9"` e `<Secao numero="9" titulo="Alterações">` por `numero="10"`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd frontend && npx vitest run src/tests/legal.test.jsx
```

Esperado: todos os casos do arquivo passam.

- [ ] **Step 5: Commit**

```bash
/opt/homebrew/bin/git add frontend/src/pages/legal/Privacidade.jsx frontend/src/tests/legal.test.jsx
/opt/homebrew/bin/git commit -m "docs(legal): declarar a verificacao publica de laudo na politica de privacidade"
```

---

## Ordem de implantação

A ordem importa porque duas etapas são irreversíveis na prática. Um laudo já entregue com QR apontando para uma rota que ainda não existe não tem conserto: o PDF está com o cliente.

1. Migration (Task 3) aplicada antes do deploy do código.
2. Deploy do backend com a rota pública (Task 6) já respondendo.
3. Conferir `FRONTEND_URL` no ambiente de produção **antes** do deploy do PDF (Task 7). Um laudo impresso com `localhost` tem QR que não abre em lugar nenhum.
4. Deploy do frontend com a página (Task 8).
5. Só então o backfill (Task 10), primeiro em modo seco.

## Pontos para decisão antes do merge

- **Versão dos documentos legais.** A Task 12 acrescenta uma finalidade de tratamento à Política de Privacidade. Os próprios Termos prometem aviso de 30 dias para mudança relevante, e a versão (`VIGENCIA` em `LegalLayout.jsx` e `TERMS_VERSION` no servidor) está propositalmente congelada esperando a entrada do CNPJ da Star Juri. É preciso decidir se a verificação pública entra junto desse bump ou se antecipa o aviso. Recomendação: antecipar, porque a funcionalidade publica dado pessoal em página aberta e não convém que ela vá ao ar sob uma política que não a menciona.
- **Laudos antigos reimpressos.** Depois do backfill, um laudo antigo baixado de novo sai com QR e código, enquanto a cópia que o cliente já tem não tem nenhum dos dois. Os dois documentos são autênticos e têm conteúdo idêntico, mas só um se verifica sozinho. Vale um aviso aos clientes, ou não.
- **Idioma do código impresso.** O formato `FD-0000-0000-0000` foi escolhido para ser ditado por telefone. Se a preferência for um código mais curto, o caminho é reduzir para 10 caracteres (50 bits), que ainda é inviável de enumerar sob o limite de 20 consultas por minuto. Abaixo disso não.

## Fora de escopo, e por quê

- **Conferir o arquivo PDF enviado pelo usuário.** Seria o ideal: subir o PDF recebido e o sistema dizer se aqueles bytes são os emitidos. Não entra porque a saída do PDFKit não é estável byte a byte (`CreationDate`, `ModDate` e `/ID` mudam a cada geração), e prometer isso sem antes tornar a geração determinística daria falso negativo em documento legítimo. É a evolução natural desta funcionalidade, em plano próprio.
- **Assinatura digital ICP-Brasil no PDF.** Resolve um problema diferente e maior: prova a autoria perante terceiros sem depender do ForenseDoc estar no ar. Exige certificado, carimbo do tempo e política de assinatura. Merece decisão comercial própria.
- **Endpoint de eliminação a pedido do titular.** A função `anonimizarVerificacao` existe e está testada, mas não há hoje no sistema nenhum fluxo de autoatendimento de eliminação a que ligá-la. Enquanto não houver, o operador da plataforma executa pelo console.
- **Exibir o resultado da perícia na página pública.** Decisão de projeto 4. Autenticidade e conteúdo são perguntas diferentes e só a primeira é pública.

## Riscos conhecidos

| Risco | Consequência | Mitigação no plano |
|---|---|---|
| `FRONTEND_URL` errado em produção | laudos impressos com QR morto, sem conserto | Task 7 Step 7 documenta a variável; a ordem de implantação a coloca antes do deploy do PDF |
| Emissão falha e o laudo fica sem registro | página responde "não encontrado" para laudo legítimo | Task 4 isola a falha e o backfill da Task 10 recupera |
| Alguém acrescenta campo ao `publicSnapshot` sem pensar | vazamento de dado pessoal em rota aberta | Lista de permissão em `montarSnapshotPublico`, com teste que falha se `placar` ou o nome do arquivo aparecerem |
| Recálculo desnecessário invalida laudo correto | cliente vê "substituído" sem que nada tenha mudado | Task 5 compara o hash antes de reemitir |
| Varredura de códigos | enumeração de laudos | 60 bits de entropia, limite de 20 por minuto por IP e registro em auditoria |

## Checklist de aceitação

- [ ] Um laudo novo sai com QR legível pela câmera de um celular comum, e o QR abre a página de verificação.
- [ ] A página mostra o mesmo SHA-256 impresso no laudo.
- [ ] O nome e o CPF aparecem mascarados, e o JSON da resposta não contém o valor completo de nenhum dos dois.
- [ ] A resposta pública não contém `tenantId`, `analysisId`, nome de arquivo nem qualquer campo do sumário de irregularidades.
- [ ] Colar o hash do laudo no formulário da página inicial leva ao mesmo resultado do QR.
- [ ] Corrigir um campo da análise reemite o laudo, e o código antigo passa a dizer "substituído" apontando para o novo.
- [ ] Salvar a revisão sem alterar nada **não** reemite nada.
- [ ] Chave inexistente e chave malformada devolvem exatamente o mesmo corpo de erro.
- [ ] `cd backend && npx vitest run` e `cd frontend && npx vitest run` passam sem falha nova.
- [ ] `cd frontend && npx vite build` conclui.
