import Redis from "ioredis";
import "dotenv/config";

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

redis.on("error", (err) => {
  console.error("[Redis] Erro de conexão:", err);
});

redis.on("connect", () => {
  console.log("[Redis] Conectado com sucesso.");
});
