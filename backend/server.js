import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import "dotenv/config";
import routes from "./src/routes/index.js";
import { globalLimiter } from "./src/middleware/rateLimiters.js";
import { redactUrl, requestContext } from "./src/utils/logRedaction.js";
import "./src/worker.js";

const app = express();

// Railway roda atrás de um proxy reverso — sem isso, express-rate-limit e
// req.ip não conseguem identificar o IP real do cliente a partir do
// X-Forwarded-For (rate limit e audit log ficariam incorretos).
app.set("trust proxy", 1);

// ─── Segurança: cabeçalhos HTTP ───────────────────────────────────────────────
// No Railway, helmet substitui o Nginx para headers de segurança.
// Na VPS (produção), os headers serão movidos para o Nginx.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
        fontSrc: ["'self'", "fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "tile.openstreetmap.org", "*.tile.openstreetmap.org"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
    noSniff: true,
  })
);

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === "production";

// Em desenvolvimento, localhost e 127.0.0.1 são origens DIFERENTES para o
// navegador, e o proxy do Vite repassa o Origin original — servir o front em
// 127.0.0.1 com CORS_ORIGIN=localhost bloqueia toda chamada. Aceitar as duas
// formas em qualquer porta evita esse atrito. Nunca vale em produção.
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (ex: Postman, Railway health checks)
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && DEV_ORIGIN_RE.test(origin)) return callback(null, true);

      // Origem recusada é 403, não 500. Sem o `status`, o handler global tratava
      // a rejeição como falha do servidor: em produção devolvia "Erro interno do
      // servidor." (mentira — a requisição é que era inválida) e em dev vazava o
      // stack trace de uma condição totalmente esperada.
      const err = new Error(`CORS bloqueado para origem: ${origin}`);
      err.status = 403;
      err.expose = true;
      callback(err);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body Parser ──────────────────────────────────────────────────────────────
// Limite apertado por padrão. Só /api/analyze recebe PDF e precisa dos 30 MB —
// ele aplica o próprio parser (ver routes/index.js). Deixar 30 MB no global
// dava a qualquer rota, inclusive /auth/login e o webhook, um corpo 30x maior
// do que qualquer uma delas tem motivo para aceitar.
//
// O `skip` de /api/analyze é obrigatório: este middleware roda ANTES do
// roteador, então sem ele o teto de 1 MB derrubava o upload de PDF com 413
// antes de a rota sequer ser escolhida — e o parser de 42 MB declarado lá nunca
// chegava a ser usado.
const jsonParser = express.json({ limit: "1mb" });
app.use((req, res, next) => {
  if (req.path === "/api/analyze") return next();
  return jsonParser(req, res, next);
});
app.use(cookieParser());

// ─── Rate limit global ────────────────────────────────────────────────────────
// Piso para TODA a API, incluindo rotas públicas sem limitador próprio e o
// handler de 404 — que antes aceitavam volume ilimitado. Não substitui os
// limites por rota; garante que nenhum caminho fique com teto infinito.
app.use("/api", globalLimiter);

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use("/api", routes);

// ─── Health Check (Railway / Load Balancer) ──────────────────────────────────
// Importante: o healthcheck NÃO deve consultar o banco de dados ou qualquer
// dependência externa. Ele precisa responder rapidamente para que o Railway
// não interprete o serviço como indisponível durante o deploy.
// Resposta mínima de propósito: o endpoint é público e versão + ambiente só
// ajudam quem está mapeando o alvo. O load balancer só precisa do 200.
app.get("/health", (_req, res) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ─── Readiness Check (diagnóstico — FL.4) ────────────────────────────────────
// Este SIM consulta as dependências, e por isso NÃO é o endpoint apontado no
// healthcheck do Railway: uma oscilação momentânea do Postgres reiniciaria a
// API inteira, transformando uma falha parcial numa queda total. Usar
// manualmente ou em monitoramento externo.
app.get("/health/ready", async (_req, res) => {
  const checks = { db: "unknown", redis: "unknown" };

  const [dbResult, redisResult] = await Promise.allSettled([
    import("./src/utils/prisma.js").then(({ prisma }) => prisma.$queryRaw`SELECT 1`),
    import("./src/utils/redis.js").then(({ redis }) => redis.ping()),
  ]);

  checks.db = dbResult.status === "fulfilled" ? "ok" : "error";
  checks.redis = redisResult.status === "fulfilled" ? "ok" : "error";

  const healthy = checks.db === "ok" && checks.redis === "ok";

  return res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    ...checks,
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

// ─── Error Handler Global ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const isDev = process.env.NODE_ENV === "development";
  const status = err.status || 500;

  // Erro de cliente (4xx) é ruído esperado — loga como warn e sem stack, para
  // que o console de erro continue significando "algo quebrou aqui dentro".
  const contexto = requestContext(req);
  const mensagem = redactUrl(err.message);
  if (status >= 500) {
    console.error("[ForenseDoc] Erro interno:", mensagem, contexto);
  } else {
    console.warn(`[ForenseDoc] Requisição recusada (${status}):`, mensagem, contexto);
  }

  // `expose` marca a mensagem como segura para o cliente (ex.: origem de CORS
  // recusada). O resto continua genérico em produção: mensagem de erro interno
  // é onde vazam nome de tabela, driver e caminho de arquivo.
  const podeExpor = err.expose === true || isDev;
  return res.status(status).json({
    error: podeExpor ? mensagem : "Erro interno do servidor.",
    ...(isDev && status >= 500 && { stack: err.stack }),
  });
});

// ─── Inicialização ───────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 8787;
const HOST = "0.0.0.0";

let server;

try {
  server = app.listen(PORT, HOST, () => {
    console.log(`[ForenseDoc v3.0] ✅ Backend iniciado com sucesso em http://${HOST}:${PORT}`);
    console.log(`[ForenseDoc v3.0] Ambiente: ${process.env.NODE_ENV || "development"}`);
    console.log(`[ForenseDoc v3.0] Healthcheck disponível em /health`);
  });

  server.on("error", (err) => {
    console.error("[ForenseDoc v3.0] ❌ Erro ao iniciar o servidor:", err.message);
    process.exit(1);
  });
} catch (err) {
  console.error("[ForenseDoc v3.0] ❌ Falha crítica na inicialização do servidor:", err);
  process.exit(1);
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`[ForenseDoc v3.0] Recebido ${signal}, encerrando servidor graciosamente...`);

  // Força o encerramento caso o graceful shutdown demore demais
  const forceTimer = setTimeout(() => {
    console.error("[ForenseDoc v3.0] Encerramento forçado após timeout.");
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Fechar conexões do Prisma e Redis
    const { prisma } = await import("./src/utils/prisma.js");
    const { redis } = await import("./src/utils/redis.js");

    await prisma.$disconnect();
    redis.disconnect();

    console.log("[ForenseDoc v3.0] Servidor encerrado com sucesso.");
    process.exit(0);
  } catch (err) {
    console.error("[ForenseDoc v3.0] Erro durante encerramento:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("[ForenseDoc v3.0] ❌ Exceção não tratada:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[ForenseDoc v3.0] ❌ Rejeição de Promise não tratada:", reason);
});
