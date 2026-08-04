import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import "dotenv/config";

const ACCESS_SECRET = process.env.JWT_SECRET;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "15m";

if (!ACCESS_SECRET) {
  throw new Error("JWT_SECRET não está definido nas variáveis de ambiente.");
}

export function generateAccessToken(payload) {
  // payload deve conter: { userId, tenantId, role, isPlatformAdmin, status }
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/**
 * Segredo do desafio de segundo fator, DERIVADO do de acesso.
 *
 * Assinar o desafio com o mesmo segredo do access token seria um buraco direto:
 * o desafio é emitido quando a senha bateu mas o TOTP ainda não, e `verifyAccessToken`
 * o aceitaria como sessão válida. Bastaria mandar o desafio no header
 * `Authorization` para pular o segundo fator inteiro.
 *
 * Derivar por HMAC mantém uma única variável de ambiente para operar e ainda
 * assim produz chaves distintas: um token assinado com uma nunca verifica na
 * outra, sem depender de o código lembrar de conferir um campo `typ`.
 */
const CHALLENGE_SECRET = crypto
  .createHmac("sha256", ACCESS_SECRET)
  .update("forensedoc:totp-challenge:v1")
  .digest("hex");

/**
 * Cinco minutos: tempo de pegar o celular e ler o código, e não mais que isso.
 * O desafio é a prova de que a senha já foi apresentada, então ele é sensível.
 */
export function generateTotpChallenge(payload) {
  return jwt.sign(payload, CHALLENGE_SECRET, { expiresIn: "5m" });
}

export function verifyTotpChallenge(token) {
  return jwt.verify(token, CHALLENGE_SECRET);
}
