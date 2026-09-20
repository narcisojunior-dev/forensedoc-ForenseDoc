-- CreateEnum
CREATE TYPE "LaudoVerificationStatus" AS ENUM ('VALIDO', 'SUBSTITUIDO', 'CANCELADO', 'DADOS_REMOVIDOS');

-- CreateTable
CREATE TABLE "laudo_verifications" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "laudoHash" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "LaudoVerificationStatus" NOT NULL DEFAULT 'VALIDO',
    "emitidoEm" TIMESTAMP(3) NOT NULL,
    "publicSnapshot" JSONB NOT NULL,
    "analysisId" TEXT,
    "tenantId" TEXT,
    "substituidoPorId" TEXT,
    "canceladoEm" TIMESTAMP(3),
    "canceladoMotivo" TEXT,
    "dadosRemovidosEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "laudo_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "laudo_verifications_codigo_key" ON "laudo_verifications"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "laudo_verifications_laudoHash_key" ON "laudo_verifications"("laudoHash");

-- CreateIndex
CREATE UNIQUE INDEX "laudo_verifications_substituidoPorId_key" ON "laudo_verifications"("substituidoPorId");

-- CreateIndex
CREATE INDEX "laudo_verifications_analysisId_idx" ON "laudo_verifications"("analysisId");

-- CreateIndex
CREATE INDEX "laudo_verifications_tenantId_idx" ON "laudo_verifications"("tenantId");

-- AddForeignKey
ALTER TABLE "laudo_verifications" ADD CONSTRAINT "laudo_verifications_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laudo_verifications" ADD CONSTRAINT "laudo_verifications_substituidoPorId_fkey" FOREIGN KEY ("substituidoPorId") REFERENCES "laudo_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
