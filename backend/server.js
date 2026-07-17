import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import "dotenv/config";
import routes from "./src/routes/index.js";
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
        fontSrc: ["fonts.gstatic.com"],
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
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173").split(",");
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (ex: Postman, Railway health checks)
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS bloqueado para origem: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body Parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "30mb" }));
app.use(cookieParser());

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use("/api", routes);

// ─── Health Check (Railway / Load Balancer) ──────────────────────────────────
// Importante: o healthcheck NÃO deve consultar o banco de dados ou qualquer
// dependência externa. Ele precisa responder rapidamente para que o Railway
// não interprete o serviço como indisponível durante o deploy.
app.get("/health", (_req, res) => {
  return res.status(200).json({
    status: "ok",
    version: "3.0.0",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

// ─── Error Handler Global ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const isDev = process.env.NODE_ENV === "development";
  console.error("[ForenseDoc] Erro interno:", err.message);
  return res.status(err.status || 500).json({
    error: isDev ? err.message : "Erro interno do servidor.",
    ...(isDev && { stack: err.stack }),
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
