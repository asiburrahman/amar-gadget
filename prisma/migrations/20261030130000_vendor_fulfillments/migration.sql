BEGIN;
-- A shipment assignment is captured at item creation, not inferred again from
-- the mutable catalog on every seller read. Existing rows use their currently
-- recorded catalog owner; historical delivery times remain explicitly unknown.
ALTER TABLE "Order" ADD COLUMN "fulfillmentVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("fulfillmentVersion">=1);
ALTER TABLE "OrderEvent" ADD COLUMN "fulfillmentId" VARCHAR(64), ADD COLUMN "fulfillmentStatus" VARCHAR(16);
CREATE TABLE "OrderFulfillment" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "orderId" TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "sellerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 status TEXT NOT NULL DEFAULT 'PENDING', version INTEGER NOT NULL DEFAULT 1 CHECK (version>=1),
 carrier VARCHAR(80), "trackingNumber" VARCHAR(120), "shippedAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
 "codCollected" BOOLEAN NOT NULL DEFAULT false, "codCollectedAt" TIMESTAMP(3),
 "legacySnapshot" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "OrderFulfillment_state" CHECK (status IN ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
 CONSTRAINT "OrderFulfillment_tracking" CHECK ("legacySnapshot" OR (
   (carrier IS NULL AND "trackingNumber" IS NULL) OR
   (carrier IS NOT NULL AND "trackingNumber" IS NOT NULL AND char_length(btrim(carrier))>=2 AND char_length(btrim("trackingNumber"))>=2 AND carrier !~ '[[:cntrl:]]' AND "trackingNumber" !~ '[[:cntrl:]]'))),
 CONSTRAINT "OrderFulfillment_shipped" CHECK (status<>'SHIPPED' OR "legacySnapshot" OR (carrier IS NOT NULL AND "trackingNumber" IS NOT NULL AND "shippedAt" IS NOT NULL)),
 CONSTRAINT "OrderFulfillment_delivered" CHECK (status<>'DELIVERED' OR "legacySnapshot" OR "deliveredAt" IS NOT NULL),
 CONSTRAINT "OrderFulfillment_cod" CHECK ((NOT "codCollected" AND "codCollectedAt" IS NULL) OR ("codCollected" AND status='DELIVERED' AND ("codCollectedAt" IS NOT NULL OR "legacySnapshot")))
);
CREATE UNIQUE INDEX "OrderFulfillment_orderId_sellerId_key" ON "OrderFulfillment"("orderId","sellerId");
CREATE INDEX "OrderFulfillment_sellerId_createdAt_id_idx" ON "OrderFulfillment"("sellerId","createdAt" DESC,id);
CREATE INDEX "OrderFulfillment_sellerId_status_createdAt_id_idx" ON "OrderFulfillment"("sellerId",status,"createdAt" DESC,id);
CREATE TABLE "FulfillmentEvent" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, sequence BIGSERIAL NOT NULL UNIQUE,
 "fulfillmentId" TEXT NOT NULL REFERENCES "OrderFulfillment"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 kind TEXT NOT NULL, "previousStatus" TEXT, status TEXT NOT NULL, carrier VARCHAR(80), "trackingNumber" VARCHAR(120),
 "codCollected" BOOLEAN NOT NULL, "actorId" VARCHAR(64), "actorRole" VARCHAR(16),
 "occurredAt" TIMESTAMP(3), "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FulfillmentEvent_fulfillmentId_sequence_idx" ON "FulfillmentEvent"("fulfillmentId",sequence);
ALTER TABLE "OrderItem" ADD COLUMN "fulfillmentId" TEXT REFERENCES "OrderFulfillment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OrderItem_fulfillmentId_id_idx" ON "OrderItem"("fulfillmentId",id);

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "Order" WHERE status NOT IN ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED')) THEN
  RAISE EXCEPTION 'Review unsupported historical order states before fulfillment migration' USING ERRCODE='23514';
 END IF;
END $$;
INSERT INTO "OrderFulfillment" ("orderId","sellerId",status,carrier,"trackingNumber","codCollected","legacySnapshot","createdAt","updatedAt")
 SELECT DISTINCT o.id,p."sellerId",o.status,o."shippingCarrier",o."shipmentTrackingNumber",
  o."paymentMethod"='COD' AND o.status='DELIVERED' AND o."paymentStatus"='PAID',true,o."createdAt",timezone('UTC',clock_timestamp())
 FROM "Order" o JOIN "OrderItem" i ON i."orderId"=o.id JOIN "Product" p ON p.id=i."productId";
UPDATE "OrderItem" i SET "fulfillmentId"=f.id FROM "Product" p,"OrderFulfillment" f
 WHERE p.id=i."productId" AND f."orderId"=i."orderId" AND f."sellerId"=p."sellerId";
INSERT INTO "FulfillmentEvent" ("fulfillmentId",kind,status,carrier,"trackingNumber","codCollected","recordedAt")
 SELECT id,'LEGACY_SNAPSHOT',status,carrier,"trackingNumber","codCollected",timezone('UTC',clock_timestamp()) FROM "OrderFulfillment";
INSERT INTO "OrderEvent" ("orderId",kind,"fulfillmentId","fulfillmentStatus","shippingCarrier","shipmentTrackingNumber","recordedAt")
 SELECT "orderId",'LEGACY_SHIPMENT_SNAPSHOT',id,status,carrier,"trackingNumber",timezone('UTC',clock_timestamp()) FROM "OrderFulfillment";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_fulfillment_required" CHECK ("fulfillmentId" IS NOT NULL);
-- Multiple shipments have no single authoritative carrier/tracking pair.
-- The earlier order-level event remains intact; each legacy group retains it.
UPDATE "Order" o SET "shippingCarrier"=NULL,"shipmentTrackingNumber"=NULL
 WHERE (SELECT count(*) FROM "OrderFulfillment" f WHERE f."orderId"=o.id)>1;

CREATE FUNCTION bind_order_item_fulfillment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE vendor TEXT; assigned "OrderFulfillment"%ROWTYPE; parent "Order"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."orderId"<>OLD."orderId" OR NEW."productId"<>OLD."productId" OR NEW."fulfillmentId" IS DISTINCT FROM OLD."fulfillmentId" THEN
   RAISE EXCEPTION 'An order item shipment assignment is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM "Order" WHERE id=NEW."orderId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order does not exist' USING ERRCODE='23503'; END IF;
 SELECT "sellerId" INTO vendor FROM "Product" WHERE id=NEW."productId";
 IF vendor IS NULL THEN RAISE EXCEPTION 'Product owner is missing' USING ERRCODE='23503'; END IF;
 IF NEW."fulfillmentId" IS NULL THEN
  SELECT * INTO assigned FROM "OrderFulfillment" WHERE "orderId"=NEW."orderId" AND "sellerId"=vendor;
  IF NOT FOUND THEN
   IF parent.status NOT IN ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'Cannot append a shipment to an order in progress' USING ERRCODE='23514'; END IF;
   INSERT INTO "OrderFulfillment" ("orderId","sellerId",status,carrier,"trackingNumber","codCollected","legacySnapshot","createdAt","updatedAt")
    VALUES(parent.id,vendor,parent.status,parent."shippingCarrier",parent."shipmentTrackingNumber",
     parent."paymentMethod"='COD' AND parent.status='DELIVERED' AND parent."paymentStatus"='PAID',
     parent.status IN ('SHIPPED','DELIVERED','CANCELLED'),parent."createdAt",timezone('UTC',clock_timestamp())) RETURNING * INTO assigned;
  END IF;
  NEW."fulfillmentId":=assigned.id;
 ELSE
  SELECT * INTO assigned FROM "OrderFulfillment" WHERE id=NEW."fulfillmentId";
 END IF;
 IF assigned.id IS NULL OR assigned."orderId"<>NEW."orderId" OR assigned."sellerId"<>vendor THEN
  RAISE EXCEPTION 'Order item shipment ownership is invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderItem_bind_fulfillment" BEFORE INSERT OR UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION bind_order_item_fulfillment();

CREATE FUNCTION guard_order_fulfillment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE method TEXT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW."orderId"<>OLD."orderId" OR NEW."sellerId"<>OLD."sellerId" OR NEW."legacySnapshot"<>OLD."legacySnapshot" THEN RAISE EXCEPTION 'Shipment identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Shipment changes require the next revision' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='PENDING' AND NEW.status IN ('PROCESSING','CANCELLED')) OR
    (OLD.status='PROCESSING' AND NEW.status IN ('SHIPPED','DELIVERED','CANCELLED')) OR
    (OLD.status='SHIPPED' AND NEW.status='DELIVERED')) THEN RAISE EXCEPTION 'Invalid shipment transition' USING ERRCODE='23514'; END IF;
  IF OLD."codCollected" AND NOT NEW."codCollected" THEN RAISE EXCEPTION 'Collection reversal requires reconciliation' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT "paymentMethod" INTO method FROM "Order" WHERE id=NEW."orderId";
 IF NEW."codCollected" AND method<>'COD' THEN RAISE EXCEPTION 'Card payment is confirmed by the payment provider' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderFulfillment_guard" BEFORE INSERT OR UPDATE ON "OrderFulfillment" FOR EACH ROW EXECUTE FUNCTION guard_order_fulfillment();
CREATE FUNCTION record_fulfillment_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE label TEXT; prior TEXT; instant TIMESTAMP(3):=timezone('UTC',clock_timestamp());
BEGIN
 IF TG_OP='INSERT' THEN label:=CASE WHEN NEW."legacySnapshot" THEN 'LEGACY_SNAPSHOT' ELSE 'SHIPMENT_CREATED' END;
 ELSE
  prior:=OLD.status;
  label:=CASE WHEN NEW.status<>OLD.status THEN 'SHIPMENT_'||NEW.status WHEN NEW."codCollected" IS DISTINCT FROM OLD."codCollected" THEN 'COD_COLLECTED' ELSE 'SHIPMENT_UPDATED' END;
 END IF;
 INSERT INTO "FulfillmentEvent" ("fulfillmentId",kind,"previousStatus",status,carrier,"trackingNumber","codCollected","actorId","actorRole","occurredAt","recordedAt")
 VALUES(NEW.id,label,prior,NEW.status,NEW.carrier,NEW."trackingNumber",NEW."codCollected",
  NULLIF(current_setting('amar.fulfillment_actor_id',true),''),NULLIF(current_setting('amar.fulfillment_actor_role',true),''),
  CASE WHEN label='LEGACY_SNAPSHOT' THEN NULL ELSE instant END,instant);
 INSERT INTO "OrderEvent" ("orderId",kind,"fulfillmentId","fulfillmentStatus","shippingCarrier","shipmentTrackingNumber","occurredAt","recordedAt")
 VALUES(NEW."orderId",CASE WHEN label='LEGACY_SNAPSHOT' THEN 'LEGACY_SHIPMENT_SNAPSHOT' ELSE 'VENDOR_'||label END,
  NEW.id,NEW.status,NEW.carrier,NEW."trackingNumber",CASE WHEN label='LEGACY_SNAPSHOT' THEN NULL ELSE instant END,instant);
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderFulfillment_record_event" AFTER INSERT OR UPDATE ON "OrderFulfillment" FOR EACH ROW EXECUTE FUNCTION record_fulfillment_event();
CREATE FUNCTION protect_fulfillment_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM "OrderFulfillment" WHERE id=OLD."fulfillmentId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Shipment history is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "FulfillmentEvent_immutable" BEFORE UPDATE OR DELETE ON "FulfillmentEvent" FOR EACH ROW EXECUTE FUNCTION protect_fulfillment_event();

CREATE FUNCTION aggregate_order_fulfillments(target TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
 SELECT CASE
 WHEN count(*)=0 THEN NULL
 WHEN bool_and(f.status='CANCELLED') THEN 'CANCELLED'
 WHEN bool_or(f.status='CANCELLED') THEN 'INVALID_PARTIAL_CANCELLATION'
 WHEN bool_and(f.status='DELIVERED') THEN 'DELIVERED'
 WHEN bool_or(f.status='DELIVERED') THEN 'PARTIALLY_DELIVERED'
 WHEN bool_and(f.status='SHIPPED') THEN 'SHIPPED'
 WHEN bool_or(f.status='SHIPPED') THEN 'PARTIALLY_SHIPPED'
 WHEN bool_and(f.status='PENDING') THEN 'PENDING'
 ELSE 'PROCESSING' END
 FROM "OrderFulfillment" f WHERE f."orderId"=target AND EXISTS(SELECT 1 FROM "OrderItem" i WHERE i."fulfillmentId"=f.id)
$$;
CREATE FUNCTION validate_order_fulfillment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target TEXT; summary TEXT; actual TEXT;
BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD."orderId" ELSE NEW."orderId" END; END IF;
 SELECT status INTO actual FROM "Order" WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 summary:=aggregate_order_fulfillments(target);
 IF summary IS NOT NULL AND summary<>actual THEN RAISE EXCEPTION 'Order state must match its shipments' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "OrderItem" i JOIN "OrderFulfillment" f ON f.id=i."fulfillmentId" WHERE i."orderId"=target AND f."orderId"<>i."orderId") THEN RAISE EXCEPTION 'Order item belongs to another shipment' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Order_fulfillment_consistent" AFTER INSERT OR UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_fulfillment();
CREATE CONSTRAINT TRIGGER "OrderFulfillment_order_consistent" AFTER INSERT OR UPDATE OR DELETE ON "OrderFulfillment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_fulfillment();
CREATE CONSTRAINT TRIGGER "OrderItem_order_consistent" AFTER INSERT OR UPDATE OR DELETE ON "OrderItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_fulfillment();

-- Existing payment/reservation writers still update the order as a whole.
-- Keep their state changes atomic with each child shipment. Application
-- shipment actions use their own fresh actor/revision checks before writing.
CREATE FUNCTION bump_order_fulfillment_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."fulfillmentVersion"<OLD."fulfillmentVersion" OR NEW."fulfillmentVersion">OLD."fulfillmentVersion"+1 THEN RAISE EXCEPTION 'Invalid order shipment revision' USING ERRCODE='23514'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status OR NEW."paymentStatus" IS DISTINCT FROM OLD."paymentStatus" OR NEW."shippingCarrier" IS DISTINCT FROM OLD."shippingCarrier" OR NEW."shipmentTrackingNumber" IS DISTINCT FROM OLD."shipmentTrackingNumber" THEN
  NEW."fulfillmentVersion":=OLD."fulfillmentVersion"+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Order_fulfillment_version" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION bump_order_fulfillment_version();
CREATE FUNCTION sync_order_fulfillment_state() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE mixed BOOLEAN;
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED') THEN
  IF NEW.status='CANCELLED' AND EXISTS(SELECT 1 FROM "OrderFulfillment" WHERE "orderId"=NEW.id AND status IN ('SHIPPED','DELIVERED')) THEN RAISE EXCEPTION 'Dispatched orders require reconciliation' USING ERRCODE='23514'; END IF;
  UPDATE "OrderFulfillment" SET status=NEW.status,version=version+1,"updatedAt"=timezone('UTC',clock_timestamp()),
   "shippedAt"=CASE WHEN NEW.status='SHIPPED' THEN COALESCE("shippedAt",timezone('UTC',clock_timestamp())) ELSE "shippedAt" END,
   "deliveredAt"=CASE WHEN NEW.status='DELIVERED' THEN COALESCE("deliveredAt",timezone('UTC',clock_timestamp())) ELSE "deliveredAt" END,
   "codCollected"=CASE WHEN NEW.status='DELIVERED' AND NEW."paymentMethod"='COD' AND NEW."paymentStatus"='PAID' THEN true ELSE "codCollected" END,
   "codCollectedAt"=CASE WHEN NEW.status='DELIVERED' AND NEW."paymentMethod"='COD' AND NEW."paymentStatus"='PAID' THEN COALESCE("codCollectedAt",timezone('UTC',clock_timestamp())) ELSE "codCollectedAt" END
  WHERE "orderId"=NEW.id AND status<>NEW.status;
 END IF;
 IF NEW."shippingCarrier" IS DISTINCT FROM OLD."shippingCarrier" OR NEW."shipmentTrackingNumber" IS DISTINCT FROM OLD."shipmentTrackingNumber" THEN
  SELECT count(*)>1 INTO mixed FROM "OrderFulfillment" WHERE "orderId"=NEW.id;
  IF mixed AND (NEW."shippingCarrier" IS NOT NULL OR NEW."shipmentTrackingNumber" IS NOT NULL) THEN RAISE EXCEPTION 'Choose the individual shipment for tracking details' USING ERRCODE='23514'; END IF;
  IF NOT mixed THEN
   UPDATE "OrderFulfillment" SET carrier=NEW."shippingCarrier","trackingNumber"=NEW."shipmentTrackingNumber",version=version+1,"updatedAt"=timezone('UTC',clock_timestamp())
   WHERE "orderId"=NEW.id AND (carrier IS DISTINCT FROM NEW."shippingCarrier" OR "trackingNumber" IS DISTINCT FROM NEW."shipmentTrackingNumber");
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Order_sync_fulfillments" AFTER UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION sync_order_fulfillment_state();

CREATE OR REPLACE FUNCTION review_purchase_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE purchase_user TEXT; purchase_product TEXT; delivery TEXT; payment TEXT; method TEXT; collected BOOLEAN; seller TEXT;
BEGIN
 IF NEW."orderItemId" IS NULL THEN RETURN NEW; END IF;
 SELECT o."userId",i."productId",f.status,o."paymentStatus",o."paymentMethod",f."codCollected",f."sellerId"
 INTO purchase_user,purchase_product,delivery,payment,method,collected,seller
 FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" JOIN "OrderFulfillment" f ON f.id=i."fulfillmentId"
 WHERE i.id=NEW."orderItemId" FOR SHARE OF o,i;
 IF NOT FOUND OR purchase_user<>NEW."userId" OR purchase_product<>NEW."productId" OR seller=NEW."userId" THEN RAISE EXCEPTION 'Review purchase association is invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('PENDING','PUBLISHED') AND (delivery<>'DELIVERED' OR NOT ((method='STRIPE' AND payment='PAID') OR (method='COD' AND collected))) THEN RAISE EXCEPTION 'Review requires a delivered paid purchase' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
