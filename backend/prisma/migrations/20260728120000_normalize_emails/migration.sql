-- Normaliza os e-mails já gravados para a forma canônica (minúsculas, sem
-- espaços nas pontas) — a mesma que normalizeEmail() passa a aplicar em toda
-- gravação e consulta.
--
-- Sem isto, uma conta criada como "Joao@x.com" fica inacessível: o login passa
-- a procurar por "joao@x.com" e não encontra nada.

-- users.email é UNIQUE. Se o mesmo endereço existir em duas grafias, o UPDATE
-- violaria a constraint — então a normalização só roda quando não houver
-- colisão, e os casos colidentes são deixados para tratamento manual (são
-- contas distintas com dados distintos; fundi-las não é decisão de migration).
UPDATE "users" u
SET "email" = lower(btrim(u."email"))
WHERE u."email" <> lower(btrim(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "users" o
    WHERE o."id" <> u."id"
      AND lower(btrim(o."email")) = lower(btrim(u."email"))
  );

-- tenant_invites.email não tem constraint única: normaliza tudo.
UPDATE "tenant_invites"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

-- founder_invites.email é opcional e sem constraint única.
UPDATE "founder_invites"
SET "email" = lower(btrim("email"))
WHERE "email" IS NOT NULL AND "email" <> lower(btrim("email"));
