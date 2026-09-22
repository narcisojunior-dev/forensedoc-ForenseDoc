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
