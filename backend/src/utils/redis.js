import Redis from "ioredis";
import "dotenv/config";

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 200, 3000);
  },
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  console.error("[Redis] Erro de conexão:", err.message);
});

redis.on("connect", () => {
  console.log("[Redis] Conectado com sucesso.");
});
