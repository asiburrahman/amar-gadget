BEGIN;
ALTER TABLE "Order" ADD COLUMN "cartAcknowledgedAt" TIMESTAMP(3);
ALTER FUNCTION cart_snapshot_valid(JSONB) RENAME TO cart_snapshot_v1_valid;
CREATE FUNCTION cart_snapshot_valid(value JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF value ? 'previousReceiptId' THEN
    IF jsonb_typeof(value->'previousReceiptId') NOT IN ('null','string') THEN RETURN false; END IF;
    IF value->>'previousReceiptId' IS NOT NULL THEN
      IF value->>'ownerId' IS NOT NULL OR value->>'previousReceiptId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN false; END IF;
    END IF;
    RETURN cart_snapshot_v1_valid(value-'previousReceiptId');
  END IF;
  RETURN cart_snapshot_v1_valid(value);
END;
$$;
ALTER TABLE "Order" DROP CONSTRAINT "Order_cart_snapshot_valid";
ALTER TABLE "Order" ADD CONSTRAINT "Order_cart_snapshot_valid" CHECK ("cartSnapshot" IS NULL OR cart_snapshot_valid("cartSnapshot"));
ALTER TABLE "Order" ADD CONSTRAINT "Order_guest_cart_ack_valid" CHECK (
  "cartAcknowledgedAt" IS NULL OR ("cartSnapshot" IS NOT NULL AND "cartSnapshot"->>'ownerId' IS NULL AND "cartSnapshot"->>'sourceId' IS NOT NULL)
);
CREATE UNIQUE INDEX "Order_one_unacknowledged_guest_cart" ON "Order" (("cartSnapshot"->>'sourceId'))
  WHERE "cartAcknowledgedAt" IS NULL AND "cartSnapshot"->>'ownerId' IS NULL AND "cartSnapshot"->>'sourceId' IS NOT NULL;
CREATE INDEX "Order_guest_cart_history_idx" ON "Order" (("cartSnapshot"->>'sourceId'), (("cartSnapshot"->>'version')::integer) DESC, "createdAt" DESC, id DESC)
  WHERE "cartSnapshot"->>'ownerId' IS NULL AND "cartSnapshot"->>'sourceId' IS NOT NULL;
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId","createdAt" DESC);
COMMIT;
