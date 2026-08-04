-- Segundo fator (TOTP) para o painel administrativo.
--
-- Todas as colunas são opcionais ou têm default: usuários existentes continuam
-- entrando normalmente, e o painel só passa a exigir o segundo fator depois que
-- o admin conclui o cadastro (ver middleware/requireMfaForAdmin).

ALTER TABLE "users"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
  ADD COLUMN "totpLastStep" BIGINT,
  ADD COLUMN "totpRecoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A marca de "esta sessão foi verificada com TOTP" fica na sessão, não no
-- access token: o refresh emite token novo a cada 15 minutos sem interação, e
-- a marca precisa atravessar essa rotação sem ser reafirmada sem base.
ALTER TABLE "refresh_tokens"
  ADD COLUMN "mfaVerified" BOOLEAN NOT NULL DEFAULT false;
