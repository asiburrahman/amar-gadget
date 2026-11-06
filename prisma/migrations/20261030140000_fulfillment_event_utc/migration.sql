-- Store new event instants as UTC regardless of the PostgreSQL session timezone.
-- Preserve historical records whose original session timezone is unknown.
CREATE OR REPLACE FUNCTION record_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_time TIMESTAMP(3) := timezone('UTC',clock_timestamp());
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
