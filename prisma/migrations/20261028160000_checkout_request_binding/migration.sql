-- Nullable for orders created before idempotent checkout was introduced.
-- checkoutTokenHash already has a unique index and is the attempt lookup key.
ALTER TABLE "Order" ADD COLUMN "checkoutRequestHash" VARCHAR(64);
