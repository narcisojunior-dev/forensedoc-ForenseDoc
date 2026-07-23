# ForenseDoc v3.0 — Dockerfile (Backend)
# Funciona tanto no Railway quanto na VPS

FROM node:20-alpine AS base

# Instalar dependências do sistema para OCR (Tesseract) e PDF
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-por \
    poppler-utils \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# ── Dependências ─────────────────────────────────────
FROM base AS deps
COPY package*.json ./
# Instalar apenas dependências de produção
RUN npm ci --omit=dev && npm cache clean --force

# ── Build (gerar Prisma Client) ───────────────────────
FROM deps AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate

# ── Imagem final ──────────────────────────────────────
FROM base AS runner

WORKDIR /app

# Criar usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeuser

# Copiar artefatos do build
COPY --from=build --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodeuser:nodejs /app/prisma ./prisma
COPY --chown=nodeuser:nodejs . .

USER nodeuser

EXPOSE 8787

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "node scripts/db-deploy.js && exec node server.js"]
