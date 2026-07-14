import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import routes from "./src/routes/index.js";

const app = express();

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

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use("/api", routes);

// ─── Health Check (Railway / Load Balancer) ──────────────────────────────────
app.get("/health", async (_req, res) => {
  const health = {
    status: "ok",
    version: "3.0.0",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  };

  // Verificar conexão com banco (se Prisma estiver configurado)
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    health.db = "ok";
  } catch {
    health.db = "unavailable";
    health.status = "degraded";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  return res.status(statusCode).json(health);
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
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`[ForenseDoc v3.0] Backend rodando em http://localhost:${PORT}`);
  console.log(`[ForenseDoc v3.0] Ambiente: ${process.env.NODE_ENV || "development"}`);
});
