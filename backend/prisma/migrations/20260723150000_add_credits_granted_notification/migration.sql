-- AlterEnum
-- Novo tipo de notificação para créditos concedidos manualmente pelo admin.
--
-- IF NOT EXISTS é obrigatório aqui: o baseline (scripts/db-deploy.js) marca
-- apenas a 0_init como aplicada, então esta migration roda em bancos que
-- podem já ter o rótulo — caso de qualquer ambiente sincronizado via
-- `prisma db push` a partir do schema atual. Sem isso o deploy falha com
-- "enum label already exists" e o serviço não sobe.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CREDITS_GRANTED';
