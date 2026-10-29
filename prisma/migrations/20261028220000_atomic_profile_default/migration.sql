BEGIN;
LOCK TABLE "Address" IN EXCLUSIVE MODE;
-- Preserve every address and its original timestamps/content. For ambiguous
-- legacy defaults, retain the most recently updated, with deterministic ties.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY "userId" ORDER BY "updatedAt" DESC, "createdAt" DESC, id ASC
  ) AS position FROM "Address" WHERE "isDefault" = true
)
UPDATE "Address" SET "isDefault" = false
FROM ranked WHERE "Address".id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX "Address_one_default_per_user" ON "Address" ("userId") WHERE "isDefault" = true;
CREATE INDEX "Address_userId_idx" ON "Address" ("userId");
COMMIT;
