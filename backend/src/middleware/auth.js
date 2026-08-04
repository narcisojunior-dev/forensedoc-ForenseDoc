import { verifyAccessToken } from "../utils/jwt.js";
import { redis } from "../utils/redis.js";
import { prisma } from "../utils/prisma.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token ausente ou mal formatado." });
    }

    const token = authHeader.split(" ")[1];

    // Verificar se o token de acesso está na blacklist (após logout).
    //
    // Fail-open, pelo mesmo motivo documentado em utils/rateLimitStore.js: com
    // o Redis fora do ar, a exceção caía no catch de baixo e TODA rota
    // autenticada respondia 401 — o cache derrubava a aplicação inteira junto.
    // A blacklist é proteção secundária (o access token vive 15 min e o refresh
    // já foi revogado no logout), então degradá-la é melhor que negar acesso a
    // todos os usuários legítimos.
    try {
      if (await redis.get(`blacklist:${token}`)) {
        return res.status(401).json({ error: "Token revogado." });
      }
    } catch (redisError) {
      console.error(
        "[Auth] Redis indisponível — blacklist de logout não verificada nesta requisição:",
        redisError.message
      );
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

/**
 * Segundo fator obrigatório no painel administrativo.
 *
 * A allowlist de IP (N2) é mitigação de ORIGEM: quem estiver na rede autorizada
 * e souber a senha entra. O TOTP é mitigação de IDENTIDADE. As duas ficam, e
 * ficam juntas, porque falham por motivos diferentes.
 *
 * ─── Os dois estados de recusa dizem coisas diferentes ───────────────────────
 *
 * `ADMIN_TOTP_NOT_ENROLLED` é o admin que ainda não cadastrou: a saída é ir a
 * Configurações e cadastrar. `ADMIN_TOTP_REQUIRED` é quem cadastrou mas está
 * numa sessão aberta antes disso (ou aberta sem o segundo fator): a saída é
 * sair e entrar de novo. Um código genérico faria o operador tentar a saída
 * errada e concluir que o painel quebrou.
 *
 * ─── O modo de escapar, e por que ele existe ─────────────────────────────────
 *
 * `ADMIN_REQUIRE_TOTP=false` desliga a exigência. Não é porta dos fundos: é o
 * que evita que um erro de relógio no servidor, um aplicativo desinstalado e um
 * lote de códigos de recuperação perdido, tudo ao mesmo tempo, deixem o dono
 * sem acesso ao próprio painel. Quem tem acesso à variável de ambiente já tem
 * acesso ao banco, então isso não concede nada novo a um atacante. Fica ligado
 * por padrão, inclusive em desenvolvimento, para o caminho testado ser o que
 * roda em produção.
 */
const TOTP_EXIGIDO_NO_ADMIN = process.env.ADMIN_REQUIRE_TOTP !== "false";

export function requireMfaForAdmin(req, res, next) {
  if (!TOTP_EXIGIDO_NO_ADMIN) return next();
  if (req.auth?.mfa === true) return next();

  // A distinção entre "não cadastrou" e "sessão sem verificação" precisa do
  // estado atual do usuário, e não do token: o cadastro pode ter acontecido
  // depois de o token ter sido emitido.
  return prisma.user
    .findUnique({ where: { id: req.auth.userId }, select: { totpEnabledAt: true } })
    .then((user) => {
      if (!user?.totpEnabledAt) {
        return res.status(403).json({
          error:
            "O painel administrativo exige verificação em duas etapas. " +
            "Cadastre um aplicativo autenticador em Configurações.",
          code: "ADMIN_TOTP_NOT_ENROLLED",
        });
      }
      return res.status(403).json({
        error: "Esta sessão foi aberta sem verificação em duas etapas. Entre novamente.",
        code: "ADMIN_TOTP_REQUIRED",
      });
    })
    .catch((err) => {
      // Fail-closed, ao contrário da blacklist: aqui o custo de errar para o
      // lado restritivo é o operador tentar de novo; para o permissivo, é o
      // painel aberto sem segundo fator por causa de uma falha de banco.
      console.error("[Admin] Falha ao verificar o segundo fator:", err.message);
      return res.status(503).json({
        error: "Não foi possível verificar o segundo fator. Tente novamente.",
        code: "ADMIN_TOTP_CHECK_FAILED",
      });
    });
}
