-- Remove a cobrança de excedente (RF-12 do PRD v3.0), que nunca foi implementada.
--
-- Motivo: `Plan.excessPriceBrl` e `PaymentType.EXCESS` existiam desde a 0_init,
-- mas nenhuma linha de código jamais criou um pagamento de excedente — estourar
-- a franquia simplesmente retorna 402 em middleware/creditGuard.js. Pior: o card
-- de plano anunciava "Excedente: R$ 7,90/laudo" ao cliente pagante, prometendo
-- um serviço inexistente. O laudo avulso (R$ 79) cobre o caso "preciso de mais
-- um laudo" sem cobrança postergada nem risco de fatura-surpresa.
--
-- Se o excedente for retomado no futuro, refazer com opt-in explícito e teto
-- por ciclo — ver docs/saas/fase_final.md (B2).

-- DropColumn
-- IF EXISTS pelo mesmo motivo documentado na 20260723150000: o baseline em
-- scripts/db-deploy.js marca apenas a 0_init como aplicada, então esta migration
-- pode rodar em bancos já sincronizados via `prisma db push` a partir do schema.
ALTER TABLE "plans" DROP COLUMN IF EXISTS "excessPriceBrl";

-- AlterEnum
-- Postgres não remove rótulo de enum diretamente: recria o tipo e reaponta a
-- coluna. Antes disso, aborta se existir qualquer pagamento com type='EXCESS' —
-- nenhum código escreve esse valor, mas registro financeiro não se converte em
-- silêncio: se houver linha, um humano decide o que fazer com ela.
DO $$
DECLARE
  orfas INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PaymentType' AND e.enumlabel = 'EXCESS'
  ) THEN
    EXECUTE 'SELECT count(*) FROM "payments" WHERE "type"::text = ''EXCESS''' INTO orfas;
    IF orfas > 0 THEN
      RAISE EXCEPTION 'Existem % pagamento(s) com type=EXCESS. Migre esses registros manualmente antes de remover o rótulo do enum.', orfas;
    END IF;

    ALTER TYPE "PaymentType" RENAME TO "PaymentType_old";
    CREATE TYPE "PaymentType" AS ENUM ('SUBSCRIPTION', 'AVULSO');
    ALTER TABLE "payments"
      ALTER COLUMN "type" TYPE "PaymentType" USING ("type"::text::"PaymentType");
    DROP TYPE "PaymentType_old";
  END IF;
END
$$;
