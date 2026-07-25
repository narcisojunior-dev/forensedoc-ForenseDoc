-- Laudo avulso com desconto para assinante (substitui o excedente removido na
-- migration anterior).
--
-- Regra: quem já tem assinatura ATIVA compra o laudo extra por um preço menor
-- que os R$ 79 do não-assinante, definido por plano. O benefício é limitado a
-- N compras por ciclo de faturamento (padrão 1) — passando disso, volta ao
-- preço cheio. Preço e limite são editáveis pelo admin em PATCH /admin/plans/:id.
--
-- Diferente do excedente do PRD, não há saldo devedor nem cobrança postergada:
-- é o mesmo fluxo à vista de /billing/avulso que já existe, só com outro valor.

-- AlterTable: Plan
-- IF NOT EXISTS pelo motivo documentado na 20260723150000 — o baseline em
-- scripts/db-deploy.js marca só a 0_init como aplicada, então esta migration
-- pode rodar em banco já sincronizado via `prisma db push`.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "avulsoPriceBrl" DECIMAL(10,2);
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "avulsoDiscountLimit" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: Payment
-- Marca qual compra consumiu vaga do desconto no ciclo. Não é inferível do
-- valor pago: o preço do plano muda ao longo do tempo e a contagem do limite
-- ficaria errada retroativamente.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "avulsoDiscounted" BOOLEAN NOT NULL DEFAULT false;

-- Índice da contagem "quantos avulsos com desconto neste ciclo": a consulta
-- filtra por tenant + flag e recorta por createdAt >= currentPeriodStart.
CREATE INDEX IF NOT EXISTS "payments_tenant_avulso_discount_idx"
  ON "payments" ("tenantId", "avulsoDiscounted", "createdAt");
