ALTER TABLE "Order"
  ADD COLUMN "shippingCarrier" VARCHAR(80),
  ADD COLUMN "shipmentTrackingNumber" VARCHAR(120);

CREATE TABLE "OrderEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sequence" BIGSERIAL NOT NULL UNIQUE,
  "orderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "previousStatus" TEXT,
  "status" TEXT,
  "previousPaymentStatus" TEXT,
  "paymentStatus" TEXT,
  "shippingCarrier" VARCHAR(80),
  "shipmentTrackingNumber" VARCHAR(120),
  "occurredAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderEvent_orderId_sequence_idx" ON "OrderEvent"("orderId", "sequence");

-- Existing creation times are known. Earlier state transitions are not:
-- preserve their current state as an explicitly undated migration snapshot.
INSERT INTO "OrderEvent" ("orderId", "kind", "occurredAt", "recordedAt")
  SELECT "id", 'ORDER_PLACED', "createdAt", "createdAt" FROM "Order";
INSERT INTO "OrderEvent" ("orderId", "kind", "status", "paymentStatus", "recordedAt")
  SELECT "id", 'LEGACY_SNAPSHOT', "status", "paymentStatus", clock_timestamp() FROM "Order";

CREATE FUNCTION record_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_time TIMESTAMP(3) := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "OrderEvent" ("orderId", "kind", "status", "paymentStatus", "shippingCarrier", "shipmentTrackingNumber", "occurredAt", "recordedAt")
      VALUES (NEW."id", 'ORDER_PLACED', NEW."status", NEW."paymentStatus", NEW."shippingCarrier", NEW."shipmentTrackingNumber", NEW."createdAt", event_time);
  ELSIF OLD."status" IS DISTINCT FROM NEW."status"
     OR OLD."paymentStatus" IS DISTINCT FROM NEW."paymentStatus"
     OR OLD."shippingCarrier" IS DISTINCT FROM NEW."shippingCarrier"
     OR OLD."shipmentTrackingNumber" IS DISTINCT FROM NEW."shipmentTrackingNumber" THEN
    INSERT INTO "OrderEvent" ("orderId", "kind", "previousStatus", "status", "previousPaymentStatus", "paymentStatus", "shippingCarrier", "shipmentTrackingNumber", "occurredAt", "recordedAt")
      VALUES (NEW."id", CASE WHEN OLD."status" IS DISTINCT FROM NEW."status" OR OLD."paymentStatus" IS DISTINCT FROM NEW."paymentStatus" THEN 'STATE_CHANGED' ELSE 'SHIPMENT_UPDATED' END,
        OLD."status", NEW."status", OLD."paymentStatus", NEW."paymentStatus", NEW."shippingCarrier", NEW."shipmentTrackingNumber", event_time, event_time);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Order_record_event" AFTER INSERT OR UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION record_order_event();

CREATE FUNCTION protect_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Parent deletion retains the repository's existing cascade policy. While
  -- an order exists, its recorded history cannot be rewritten or removed.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "Order" WHERE "id" = OLD."orderId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Order history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "OrderEvent_immutable" BEFORE UPDATE OR DELETE ON "OrderEvent" FOR EACH ROW EXECUTE FUNCTION protect_order_event();
