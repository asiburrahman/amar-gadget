CREATE TABLE "Cart" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  "couponCode" VARCHAR(64), "couponVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("couponVersion" >= 0),
  "lastRequestId" VARCHAR(36), "lastRequestHash" VARCHAR(64), "lastResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Cart_last_request_complete" CHECK (
    ("lastRequestId" IS NULL AND "lastRequestHash" IS NULL AND "lastResult" IS NULL) OR
    ("lastRequestId" IS NOT NULL AND "lastRequestHash" IS NOT NULL AND "lastResult" IS NOT NULL AND "lastRequestHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("lastResult")='object')
  )
);
CREATE TABLE "CartLine" (
  id TEXT PRIMARY KEY,
  "cartUserId" TEXT NOT NULL REFERENCES "Cart"("userId") ON DELETE CASCADE,
  "productId" VARCHAR(64) NOT NULL CHECK ("productId" ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CartLine_cartUserId_productId_key" UNIQUE ("cartUserId","productId")
);
CREATE INDEX "CartLine_cartUserId_createdAt_id_idx" ON "CartLine"("cartUserId","createdAt",id);
ALTER TABLE "Order" ADD COLUMN "cartSnapshot" JSONB, ADD COLUMN "cartConsumedAt" TIMESTAMP(3);

CREATE FUNCTION cart_snapshot_valid(value JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; ids TEXT[] := ARRAY[]::TEXT[]; products TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (value ?& ARRAY['ownerId','sourceId','version','couponVersion','couponCode','lines']) OR
     (SELECT count(*) FROM jsonb_object_keys(value)) <> 6 THEN RETURN false; END IF;
  IF jsonb_typeof(value->'ownerId') NOT IN ('string','null') OR jsonb_typeof(value->'sourceId') NOT IN ('string','null') THEN RETURN false; END IF;
  IF value->>'ownerId' IS NULL THEN
    IF value->>'sourceId' IS NULL OR value->>'sourceId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN false; END IF;
  ELSE
    IF value->>'ownerId' !~ '^[A-Za-z0-9-]{1,64}$' OR value->>'sourceId' IS NOT NULL THEN RETURN false; END IF;
  END IF;
  IF jsonb_typeof(value->'version') <> 'number' OR (value->>'version') !~ '^[0-9]{1,10}$' OR
     jsonb_typeof(value->'couponVersion') <> 'number' OR (value->>'couponVersion') !~ '^[0-9]{1,10}$' THEN RETURN false; END IF;
  IF (value->>'version')::numeric > 2147483646 OR (value->>'couponVersion')::numeric > 2147483646 THEN RETURN false; END IF;
  IF jsonb_typeof(value->'couponCode') NOT IN ('string','null') THEN RETURN false; END IF;
  IF value->>'couponCode' IS NOT NULL AND (char_length(value->>'couponCode') NOT BETWEEN 1 AND 64 OR (value->>'couponCode') ~ '[[:cntrl:]]') THEN RETURN false; END IF;
  IF jsonb_typeof(value->'lines') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value->'lines') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'lines') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (item ?& ARRAY['lineId','productId','quantity']) OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3 THEN RETURN false; END IF;
    IF jsonb_typeof(item->'lineId') <> 'string' OR (item->>'lineId') !~ '^[A-Za-z0-9-]{1,64}$' OR
       jsonb_typeof(item->'productId') <> 'string' OR (item->>'productId') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR
       jsonb_typeof(item->'quantity') <> 'number' OR (item->>'quantity') !~ '^[0-9]{1,3}$' THEN RETURN false; END IF;
    IF (item->>'quantity')::integer NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
    IF item->>'lineId' = ANY(ids) OR item->>'productId' = ANY(products) THEN RETURN false; END IF;
    ids := array_append(ids,item->>'lineId'); products := array_append(products,item->>'productId');
  END LOOP;
  RETURN true;
END;
$$;
ALTER TABLE "Order" ADD CONSTRAINT "Order_cart_snapshot_valid" CHECK ("cartSnapshot" IS NULL OR cart_snapshot_valid("cartSnapshot"));
ALTER TABLE "Order" ADD CONSTRAINT "Order_cart_owner_matches" CHECK ("cartSnapshot" IS NULL OR "cartSnapshot"->>'ownerId' IS NULL OR "cartSnapshot"->>'ownerId' = "userId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_cart_consumption_has_snapshot" CHECK ("cartConsumedAt" IS NULL OR "cartSnapshot" IS NOT NULL);
CREATE UNIQUE INDEX "Order_one_active_account_cart" ON "Order"("userId")
  WHERE status='PENDING' AND "paymentStatus"='UNPAID' AND "cartSnapshot"->>'ownerId' IS NOT NULL;
