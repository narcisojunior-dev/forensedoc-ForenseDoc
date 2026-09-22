-- Segunda camada contra débito em corrida (achado B1 da auditoria de 19/09/2026).
--
-- A primeira camada é o `updateMany` com `{ gt: 0 }` no WHERE, em
-- src/services/creditService.js: a condição e o decremento viram um único
-- UPDATE atômico, então quem perde a corrida decrementa zero linhas.
--
-- Esta constraint existe porque a primeira camada é código, e código muda. Se
-- um caminho novo de débito nascer amanhã sem a condição no WHERE, o banco
-- recusa a escrita em vez de gravar saldo negativo em silêncio. Saldo negativo
-- é laudo emitido sem crédito pago, e o estrago só aparece na conciliação.
--
-- Saneamento antes da constraint: uma base que já tenha rodado com a falha pode
-- conter valores negativos, e o ALTER TABLE falharia ao validar as linhas
-- existentes. Zerar é o correto aqui, porque o negativo não representa dívida
-- do cliente, e sim crédito consumido a mais por um defeito nosso.
UPDATE "credit_balances" SET "creditsMonthly"   = 0 WHERE "creditsMonthly"   < 0;
UPDATE "credit_balances" SET "creditsAvulso"    = 0 WHERE "creditsAvulso"    < 0;
UPDATE "credit_balances" SET "creditsEmergency" = 0 WHERE "creditsEmergency" < 0;
UPDATE "credit_balances" SET "creditsManual"    = 0 WHERE "creditsManual"    < 0;

ALTER TABLE "credit_balances"
  ADD CONSTRAINT "credit_balances_nao_negativo" CHECK (
    "creditsMonthly"   >= 0 AND
    "creditsAvulso"    >= 0 AND
    "creditsEmergency" >= 0 AND
    "creditsManual"    >= 0
  );
