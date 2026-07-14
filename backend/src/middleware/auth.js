import { verifyAccessToken } from "../utils/jwt.js";
import { redis } from "../utils/redis.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token ausente ou mal formatado." });
    }

    const token = authHeader.split(" ")[1];

    // Verificar se o token de acesso está na blacklist (após logout)
    const isRevoked = await redis.get(`blacklist:${token}`);
    if (isRevoked) {
      return res.status(401).json({ error: "Token revogado." });
    }

    const payload = verifyAccessToken(token);
    
    // Anexar payload ao request
    req.auth = payload;
    req.tenantId = payload.tenantId; // tenantGuard embutido

    if (payload.status === "SUSPENDED") {
      return res.status(403).json({ error: "Conta suspensa.", code: "ACCOUNT_SUSPENDED" });
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado.", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Token inválido." });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !req.auth.role) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Sem permissão para realizar esta ação." });
    }

    next();
  };
}

export function requirePlatformAdmin(req, res, next) {
  if (!req.auth || !req.auth.isPlatformAdmin) {
    return res.status(403).json({ error: "Acesso restrito (Platform Admin)." });
  }
  next();
}
