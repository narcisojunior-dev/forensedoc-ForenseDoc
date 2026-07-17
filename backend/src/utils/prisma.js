import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  datasources: {
    db: {
      pool: {
        min: 1,
        max: 5,
        acquireTimeout: 10_000,
      },
    },
  },
});
