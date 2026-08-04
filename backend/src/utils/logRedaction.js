/**
 * Mascaramento de dados sensíveis antes de gravar em log (N7 da auditoria).
 *
 * Não havia nenhuma camada disso: qualquer `console.error(err)` que carregasse
 * um corpo de requisição, um header ou um objeto de usuário despejava senha,
 * token ou cookie em texto puro no stdout — que no Railway vai para um agregador
 * externo, com retenção e acesso próprios.
 *
 * A regra é por NOME de campo, não por formato do valor: tentar reconhecer "o
 * que parece um token" erra nos dois sentidos, enquanto o nome do campo é
 * declarado pelo próprio código.
 */

const CAMPOS_SENSIVEIS = [
  "password",
  "senha",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "tokenhash",
  "authorization",
  "cookie",
  "asaas-access-token",
  "access_token",
  "apikey",
  "api_key",
  "secret",
  "jwt_secret",
  "pdfbase64",
];

const MASCARA = "[REDACTED]";

function ehSensivel(chave) {
  const k = String(chave).toLowerCase();
  return CAMPOS_SENSIVEIS.some((campo) => k.includes(campo));
}

/**
 * Mascara o valor de parâmetros de query que carregam credencial.
 * Cobre o caso comum de um link de verificação/reset cair no log inteiro.
 */
export function redactUrl(value) {
  return String(value).replace(
    /([?&](?:token|access_token|refreshToken|code|key)=)[^&\s"']+/gi,
    `$1${MASCARA}`
  );
}

/**
 * Percorre o valor mascarando campos sensíveis.
 *
 * Guarda contra ciclos (um objeto de erro do Prisma referencia o client, que
 * referencia a config) e limita a profundidade — log não é lugar de serializar
 * grafo inteiro.
 */
export function redact(value, { depth = 0, seen = new WeakSet() } = {}) {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactUrl(value);
  if (typeof value !== "object") return value;

  if (depth > 4) return "[deep]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, { depth: depth + 1, seen }));
  }

  // Erros não são objetos comuns: message/stack não são enumeráveis.
  if (value instanceof Error) {
    return { name: value.name, message: redactUrl(value.message), code: value.code };
  }

  const saida = {};
  for (const [chave, item] of Object.entries(value)) {
    saida[chave] = ehSensivel(chave) ? MASCARA : redact(item, { depth: depth + 1, seen });
  }
  return saida;
}

/**
 * Contexto seguro de uma requisição, para acompanhar um erro no log.
 * Nunca inclui corpo, cookies nem o header Authorization.
 */
export function requestContext(req) {
  return {
    method: req.method,
    path: req.originalUrl ? redactUrl(req.originalUrl.split("?")[0]) : req.path,
    ip: req.ip,
    tenantId: req.tenantId || null,
    userId: req.auth?.userId || null,
  };
}
