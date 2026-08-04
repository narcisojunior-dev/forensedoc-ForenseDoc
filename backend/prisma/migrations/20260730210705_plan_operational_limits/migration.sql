-- DropIndex
DROP INDEX "payments_tenant_avulso_discount_idx";

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "analysesPerMinute" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "maxConcurrentAnalyses" INTEGER NOT NULL DEFAULT 1;
