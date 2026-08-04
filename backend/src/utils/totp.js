import crypto from "node:crypto";

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226), com `node:crypto`.
 *
 * ─── Por que sem biblioteca ──────────────────────────────────────────────────
 *
 * O algoritmo inteiro é um HMAC-SHA1 sobre o contador de tempo mais um
 * truncamento definido na própria RFC: cabe em poucas dezenas de linhas
 * auditáveis. Uma dependência aqui traria árvore transitiva para dentro do
 * caminho de autenticação, que é exatamente onde menos se quer código de
 * terceiro não lido.
 *
 * O padrão é fixo em SHA-1, 6 dígitos e passo de 30 s porque é o que Google
 * Authenticator, Authy, 1Password e Bitwarden implementam. SHA-1 aqui não é
 * escolha de segurança discutível: o HMAC-SHA1 não depende de resistência a
 * colisão, e o segredo é o que protege. Trocar por SHA-256 quebraria a
 * compatibilidade com a maioria dos aplicativos sem ganho prático.
 */

const DIGITOS = 6;
const PASSO_SEGUNDOS = 30;
const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Base32 (RFC 4648) sem preenchimento.
 *
 * É o encoding que os aplicativos autenticadores esperam na URL `otpauth://` e
 * na digitação manual, e por isso não pode ser trocado por base64.
 */
export function base32Encode(buffer) {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

export function base32Decode(texto) {
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const caractere of String(texto).toUpperCase().replace(/[\s=]/g, "")) {
    const indice = ALFABETO_BASE32.indexOf(caractere);
    if (indice === -1) throw new Error("Segredo TOTP com caractere inválido.");
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 20 bytes: o tamanho do bloco do HMAC-SHA1, recomendado pela RFC 4226. */
export function gerarSegredo() {
  return base32Encode(crypto.randomBytes(20));
}

/** O passo de tempo em que o código atual é válido. */
export function passoAtual(agoraMs = Date.now()) {
  return Math.floor(agoraMs / 1000 / PASSO_SEGUNDOS);
}

export function gerarCodigo(segredoBase32, passo) {
  const chave = base32Decode(segredoBase32);

  // O contador é big-endian de 8 bytes. `writeBigUInt64BE` evita o erro clássico
  // de montar só 4 bytes, que funciona até 2038 e depois passa a gerar código
  // errado sem nenhum aviso.
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));

  const hmac = crypto.createHmac("sha1", chave).update(contador).digest();

  // Truncamento dinâmico da RFC 4226 §5.3: os 4 bits finais escolhem de onde
  // ler, e o bit mais alto é zerado para o número não depender de sinal.
  const deslocamento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[deslocamento] & 0x7f) << 24) |
    (hmac[deslocamento + 1] << 16) |
    (hmac[deslocamento + 2] << 8) |
    hmac[deslocamento + 3];

  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

/**
 * Confere o código e devolve o PASSO em que ele bateu, ou null.
 *
 * Devolver o passo, e não um booleano, é o que permite ao chamador impedir
 * reuso: o mesmo código continua matematicamente válido durante toda a janela,
 * então quem interceptar um código digitado pode reapresentá-lo. Guardando o
 * último passo aceito, a segunda apresentação é recusada.
 *
 * A janela de 1 passo para trás e 1 para frente absorve relógio dessincronizado
 * no celular, que é a causa mais comum de "o código não funciona". Uma janela
 * maior multiplica o espaço de códigos aceitos ao mesmo tempo e não deve crescer
 * sem necessidade.
 */
export function verificarCodigo(segredoBase32, codigo, { janela = 1, agoraMs = Date.now() } = {}) {
  const limpo = String(codigo ?? "").replace(/\D/g, "");
  if (limpo.length !== DIGITOS) return null;

  const atual = passoAtual(agoraMs);
  for (let deriva = -janela; deriva <= janela; deriva++) {
    const passo = atual + deriva;
    const esperado = gerarCodigo(segredoBase32, passo);
    // Comparação em tempo constante: um `===` vaza, pelo tempo, quantos dígitos
    // iniciais estavam certos, e com isso o código pode ser descoberto dígito a
    // dígito em vez de por força bruta sobre o milhão de combinações.
    if (
      crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(limpo.padStart(DIGITOS, "0")))
    ) {
      return passo;
    }
  }
  return null;
}

/**
 * URL `otpauth://` que o aplicativo autenticador lê do QR.
 *
 * O `issuer` aparece duas vezes de propósito: no rótulo, porque aplicativos
 * antigos só leem dali, e como parâmetro, que é onde os atuais leem. Sem ele, a
 * entrada aparece na lista do usuário como um e-mail solto, sem dizer de qual
 * serviço é.
 */
export function montarOtpauthUrl({ segredo, email, emissor = "ForenseDoc" }) {
  const rotulo = encodeURIComponent(`${emissor}:${email}`);
  const params = new URLSearchParams({
    secret: segredo,
    issuer: emissor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PASSO_SEGUNDOS),
  });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

/** Em grupos de 4, para quem digita o segredo à mão em vez de ler o QR. */
export function formatarParaDigitacao(segredo) {
  return segredo.replace(/(.{4})/g, "$1 ").trim();
}
