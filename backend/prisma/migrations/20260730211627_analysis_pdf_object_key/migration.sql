-- AlterTable
ALTER TABLE "analyses" ADD COLUMN     "pdfObjectKey" TEXT,
ADD COLUMN     "pdfPurgedAt" TIMESTAMP(3);
