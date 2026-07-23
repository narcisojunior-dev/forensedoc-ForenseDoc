/*
  Warnings:

  - You are about to drop the column `creditTransactionId` on the `analyses` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "analyses_creditTransactionId_key";

-- DropIndex
DROP INDEX "credit_transactions_analysisId_key";

-- AlterTable
ALTER TABLE "analyses" DROP COLUMN "creditTransactionId";

-- CreateIndex
CREATE INDEX "credit_transactions_analysisId_idx" ON "credit_transactions"("analysisId");
