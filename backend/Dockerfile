# ForenseDoc v3.0 — Dockerfile (Backend)
# Funciona tanto no Railway quanto na VPS

FROM node:20-alpine AS base

# Instalar dependências do sistema para OCR (Tesseract) e PDF
# python3: Motor de Réplicas (réplica processual), executado por ponte Python.
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-por \
    poppler-utils \
    python3 \
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

# ── Diretório dos dossiês ────────────────────────────
#
# Precisa existir NA IMAGEM, e com o dono certo. Um volume nomeado montado sobre
# um caminho que não existe na imagem nasce pertencendo ao root, e o processo
# (que roda como nodeuser) não consegue escrever nele.
#
# A falha seria silenciosa, e é justamente esse o problema: `putPdf` devolve null
# e o sistema volta a mandar o PDF em base64 dentro do payload do job, ou seja,
# desfaz a migração que tirou os arquivos do Redis. O sintoma apareceria como
# Redis estourando memória sob carga, sem nada apontar para permissão de disco.
#
# Docker copia dono e permissão deste caminho ao criar o volume, então o
# `chown` aqui é o que faz o volume nascer gravável.
RUN mkdir -p /app/data/uploads && chown -R nodeuser:nodejs /app/data

USER nodeuser

EXPOSE 8787

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const p = process.env.PORT || 8787; fetch(\`http://localhost:\${p}/health\`).then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "node scripts/db-deploy.js && exec node server.js"]
