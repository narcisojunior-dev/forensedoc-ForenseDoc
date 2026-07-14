import jwt from "jsonwebtoken";
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
