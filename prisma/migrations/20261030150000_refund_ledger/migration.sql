-- AlterTable
BEGIN;
CREATE TABLE "FinancialWebhookReceipt" (id VARCHAR(120) PRIMARY KEY,kind VARCHAR(80) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
ALTER TABLE "Order" ADD COLUMN     "discountCents" BIGINT,
ADD COLUMN     "disputeAmountCents" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "disputeStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "financialReviewReason" VARCHAR(120),
ADD COLUMN     "pricingEvidence" VARCHAR(500),
ADD COLUMN     "pricingReconciledAt" TIMESTAMP(3),
ADD COLUMN     "refundState" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "refundVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "refundedCents" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "shippingCents" BIGINT,
ADD COLUMN     "shippingRefundedCents" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "subtotalCents" BIGINT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "financialVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "netCents" BIGINT,
ADD COLUMN     "refundedCents" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "retainedQuantity" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "retainedCents" BIGINT;
UPDATE "OrderItem" SET "retainedQuantity"=quantity;
-- Flush the earlier deferred shipment checks before later table DDL.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestId" VARCHAR(36) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "createdById" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "amountCents" BIGINT NOT NULL,
    "shippingCents" BIGINT NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL,
    "providerRefundId" VARCHAR(120),
    "providerPaymentIntentId" VARCHAR(120),
    "providerStatus" VARCHAR(32),
    "providerCreatedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" VARCHAR(36),
    "errorCode" VARCHAR(80),
    "manualMethod" VARCHAR(30),
    "manualReference" VARCHAR(120),
    "confirmedById" VARCHAR(64),
    "confirmedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "allocationConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundLine" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "offset" INTEGER NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "beforeDispatch" BOOLEAN NOT NULL,

    CONSTRAINT "RefundLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReturn" (
    "id" TEXT NOT NULL,
    "requestId" VARCHAR(36) NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "acceptedById" VARCHAR(64) NOT NULL,
    "evidence" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEvent" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" VARCHAR(64),
    "kind" VARCHAR(80) NOT NULL,
    "status" VARCHAR(32),
    "amountCents" BIGINT,
    "actorId" VARCHAR(64),
    "actorRole" VARCHAR(16),
    "evidence" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDispute" (
    "id" VARCHAR(120) NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_requestId_key" ON "Refund"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");

-- CreateIndex
CREATE INDEX "Refund_orderId_createdAt_id_idx" ON "Refund"("orderId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Refund_status_nextCheckAt_idx" ON "Refund"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "RefundLine_orderItemId_idx" ON "RefundLine"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundLine_refundId_orderItemId_key" ON "RefundLine"("refundId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderReturn_requestId_key" ON "OrderReturn"("requestId");

-- CreateIndex
CREATE INDEX "OrderReturn_orderItemId_createdAt_idx" ON "OrderReturn"("orderItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_sequence_key" ON "FinancialEvent"("sequence");

-- CreateIndex
CREATE INDEX "FinancialEvent_orderId_sequence_idx" ON "FinancialEvent"("orderId", "sequence");

-- CreateIndex
CREATE INDEX "FinancialEvent_refundId_sequence_idx" ON "FinancialEvent"("refundId", "sequence");

-- CreateIndex
CREATE INDEX "PaymentDispute_orderId_idx" ON "PaymentDispute"("orderId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLine" ADD CONSTRAINT "RefundLine_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLine" ADD CONSTRAINT "RefundLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentDispute" ADD COLUMN "fundsLostCents" BIGINT NOT NULL DEFAULT 0 CHECK ("fundsLostCents">=0 AND "fundsLostCents"<="amountCents");

ALTER TABLE "Order" ADD CONSTRAINT "Order_refund_money" CHECK (
 "refundVersion">=1 AND "refundedCents">=0 AND "refundedCents"<=(total*100)::bigint AND "shippingRefundedCents">=0 AND "disputeAmountCents">=0
 AND "refundState" IN ('NONE','PENDING','PARTIAL','REFUNDED','REVIEW') AND "disputeStatus" IN ('NONE','ACTIVE','WON','LOST')
 AND (("subtotalCents" IS NULL AND "discountCents" IS NULL AND "shippingCents" IS NULL AND "pricingReconciledAt" IS NULL)
 OR ("subtotalCents" IS NOT NULL AND "discountCents" IS NOT NULL AND "shippingCents" IS NOT NULL AND "subtotalCents">=0 AND "discountCents">=0 AND "shippingCents">=0 AND "discountCents"<="subtotalCents" AND "subtotalCents"-"discountCents"+"shippingCents"=(total*100)::bigint AND "pricingReconciledAt" IS NOT NULL AND "shippingRefundedCents"<="shippingCents"))
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_refund_bounds" CHECK (
 "financialVersion">=1 AND "refundedQuantity">=0 AND "refundedQuantity"<=quantity AND "voidedQuantity">=0 AND "returnedQuantity">=0
 AND "voidedQuantity"+"returnedQuantity"<=quantity AND "refundedCents">=0 AND "retainedQuantity"=quantity-"refundedQuantity" AND "retainedCents" IS NOT DISTINCT FROM "netCents"-"refundedCents" AND ("netCents" IS NULL OR ("netCents">=0 AND "netCents"<=(price*quantity*100)::bigint AND "refundedCents"<="netCents"))
);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_values" CHECK (
 version>=1 AND "amountCents">=0 AND "shippingCents">=0 AND "shippingCents"<="amountCents"
 AND kind IN ('FULL','ITEMS','EXTERNAL') AND "paymentMethod" IN ('STRIPE','COD')
 AND status IN ('QUEUED','SUBMITTING','PENDING','REQUIRES_ACTION','SUCCEEDED','FAILED','CANCELLED','REVIEW')
 AND (("leaseToken" IS NULL AND "leaseUntil" IS NULL) OR ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL))
 AND (status<>'SUCCEEDED' OR "amountCents"=0 OR ("paymentMethod"='STRIPE' AND "providerRefundId" IS NOT NULL) OR ("paymentMethod"='COD' AND "manualMethod" IS NOT NULL AND "manualReference" IS NOT NULL AND "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL))
);
ALTER TABLE "RefundLine" ADD CONSTRAINT "RefundLine_values" CHECK (quantity>=0 AND "offset">=0 AND "amountCents">=0);
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_values" CHECK (quantity>0 AND char_length(btrim(evidence))>=5);
CREATE UNIQUE INDEX "Refund_one_internal_active_order" ON "Refund"("orderId") WHERE kind<>'EXTERNAL' AND status IN ('QUEUED','SUBMITTING','PENDING','REQUIRES_ACTION','REVIEW');
CREATE UNIQUE INDEX "Refund_unique_cod_receipt" ON "Refund"("manualMethod","manualReference") WHERE "paymentMethod"='COD' AND status='SUCCEEDED' AND "amountCents">0;
CREATE INDEX "Order_paymentIntentId_idx" ON "Order"("paymentIntentId") WHERE "paymentIntentId" IS NOT NULL;

CREATE FUNCTION guard_purchase_finances() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='OrderItem' THEN
  NEW."retainedQuantity":=NEW.quantity-NEW."refundedQuantity";
  NEW."retainedCents":=NEW."netCents"-NEW."refundedCents";
  IF TG_OP='UPDATE' THEN
   IF OLD."netCents" IS NOT NULL AND (NEW."netCents" IS DISTINCT FROM OLD."netCents" OR NEW.quantity<>OLD.quantity OR NEW.price<>OLD.price) THEN RAISE EXCEPTION 'Purchase pricing is immutable' USING ERRCODE='23514'; END IF;
   IF NEW."voidedQuantity"<OLD."voidedQuantity" OR NEW."returnedQuantity"<OLD."returnedQuantity" THEN RAISE EXCEPTION 'Inventory evidence cannot be reversed silently' USING ERRCODE='23514'; END IF;
   IF (NEW."netCents" IS DISTINCT FROM OLD."netCents" OR NEW."refundedCents"<>OLD."refundedCents" OR NEW."refundedQuantity"<>OLD."refundedQuantity" OR NEW."voidedQuantity"<>OLD."voidedQuantity" OR NEW."returnedQuantity"<>OLD."returnedQuantity") AND NEW."financialVersion"<>OLD."financialVersion"+1 THEN RAISE EXCEPTION 'Item finance revision is required' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF OLD."subtotalCents" IS NOT NULL AND (NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents" OR NEW."discountCents" IS DISTINCT FROM OLD."discountCents" OR NEW."shippingCents" IS DISTINCT FROM OLD."shippingCents" OR NEW.total<>OLD.total OR NEW."pricingEvidence" IS DISTINCT FROM OLD."pricingEvidence") THEN RAISE EXCEPTION 'Order pricing snapshot is immutable' USING ERRCODE='23514'; END IF;
  IF NEW."refundVersion"<OLD."refundVersion" OR NEW."refundVersion">OLD."refundVersion"+1 THEN RAISE EXCEPTION 'Invalid financial revision' USING ERRCODE='23514'; END IF;
  IF NEW."fulfillmentVersion" IS DISTINCT FROM OLD."fulfillmentVersion" OR NEW.status IS DISTINCT FROM OLD.status OR NEW."paymentStatus" IS DISTINCT FROM OLD."paymentStatus" OR NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents" OR NEW."refundedCents"<>OLD."refundedCents" OR NEW."shippingRefundedCents"<>OLD."shippingRefundedCents" OR NEW."refundState"<>OLD."refundState" OR NEW."financialReviewReason" IS DISTINCT FROM OLD."financialReviewReason" OR NEW."disputeStatus"<>OLD."disputeStatus" OR NEW."disputeAmountCents"<>OLD."disputeAmountCents" THEN NEW."refundVersion":=OLD."refundVersion"+1; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderItem_finances_guard" BEFORE INSERT OR UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION guard_purchase_finances();
CREATE TRIGGER "Order_finances_guard" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION guard_purchase_finances();

CREATE FUNCTION guard_financial_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial records are retained' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN ('FinancialEvent','OrderReturn','FinancialWebhookReceipt') THEN RAISE EXCEPTION 'Financial evidence is append-only' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='RefundLine' THEN RAISE EXCEPTION 'Refund allocations are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.id<>OLD.id OR NEW."orderId"<>OLD."orderId" OR NEW."requestId"<>OLD."requestId" OR NEW."requestHash"<>OLD."requestHash" OR NEW."amountCents"<>OLD."amountCents" OR NEW."paymentMethod"<>OLD."paymentMethod" OR NEW.kind<>OLD.kind OR NEW."createdById"<>OLD."createdById" OR NEW.reason<>OLD.reason THEN RAISE EXCEPTION 'Refund intent is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Refund changes require the next revision' USING ERRCODE='23514'; END IF;
 IF OLD."providerRefundId" IS NOT NULL AND NEW."providerRefundId" IS DISTINCT FROM OLD."providerRefundId" THEN RAISE EXCEPTION 'Provider refund identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD."providerPaymentIntentId" IS NOT NULL AND NEW."providerPaymentIntentId" IS DISTINCT FROM OLD."providerPaymentIntentId" THEN RAISE EXCEPTION 'Provider payment identity is immutable' USING ERRCODE='23514'; END IF;
 IF OLD."allocationConfirmed" AND (NOT NEW."allocationConfirmed" OR NEW."shippingCents"<>OLD."shippingCents") THEN RAISE EXCEPTION 'Confirmed allocation is immutable' USING ERRCODE='23514'; END IF;
 IF OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN RAISE EXCEPTION 'Submission instant is immutable' USING ERRCODE='23514'; END IF;
 IF OLD."appliedAt" IS NOT NULL AND NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt" THEN RAISE EXCEPTION 'Application instant is immutable' USING ERRCODE='23514'; END IF;
 IF OLD."manualReference" IS NOT NULL AND (NEW."manualReference" IS DISTINCT FROM OLD."manualReference" OR NEW."manualMethod" IS DISTINCT FROM OLD."manualMethod" OR NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById" OR NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt") THEN RAISE EXCEPTION 'Confirmed repayment evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Refund_guard" BEFORE UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION guard_financial_record();
CREATE TRIGGER "RefundLine_guard" BEFORE UPDATE OR DELETE ON "RefundLine" FOR EACH ROW EXECUTE FUNCTION guard_financial_record();
CREATE TRIGGER "OrderReturn_guard" BEFORE UPDATE OR DELETE ON "OrderReturn" FOR EACH ROW EXECUTE FUNCTION guard_financial_record();
CREATE TRIGGER "FinancialEvent_guard" BEFORE UPDATE OR DELETE ON "FinancialEvent" FOR EACH ROW EXECUTE FUNCTION guard_financial_record();
CREATE TRIGGER "FinancialWebhookReceipt_guard" BEFORE UPDATE OR DELETE ON "FinancialWebhookReceipt" FOR EACH ROW EXECUTE FUNCTION guard_financial_record();
CREATE FUNCTION guard_physical_return() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT; available INTEGER; shipment_state TEXT;
BEGIN
 SELECT "orderId" INTO target FROM "OrderItem" WHERE id=NEW."orderItemId";
 PERFORM id FROM "Order" WHERE id=target FOR UPDATE;
 SELECT i.quantity-i."voidedQuantity"-i."returnedQuantity",f.status INTO available,shipment_state FROM "OrderItem" i JOIN "OrderFulfillment" f ON f.id=i."fulfillmentId" WHERE i.id=NEW."orderItemId" FOR UPDATE OF i;
 IF NOT FOUND OR shipment_state NOT IN ('SHIPPED','DELIVERED') OR NEW.quantity>available OR NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."acceptedById" AND role='ADMIN' AND "isVerified") THEN RAISE EXCEPTION 'Return requires actual dispatched units and administrator inspection' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderReturn_inspection_guard" BEFORE INSERT ON "OrderReturn" FOR EACH ROW EXECUTE FUNCTION guard_physical_return();
ALTER TABLE "Refund" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "OrderReturn" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "FinancialEvent" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
CREATE FUNCTION record_refund_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "FinancialEvent" (id,"orderId","refundId",kind,status,"amountCents","actorId","actorRole",evidence,"createdAt")
 VALUES(gen_random_uuid()::text,NEW."orderId",NEW.id,CASE WHEN TG_OP='INSERT' THEN 'REFUND_REQUESTED' ELSE 'REFUND_UPDATED' END,NEW.status,NEW."amountCents",NULLIF(current_setting('amar.finance_actor_id',true),''),NULLIF(current_setting('amar.finance_actor_role',true),''),NEW."errorCode",timezone('UTC',clock_timestamp()));
 RETURN NEW;
END $$;
CREATE TRIGGER "Refund_record_event" AFTER INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION record_refund_event();

CREATE FUNCTION validate_order_finances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT; parent "Order"%ROWTYPE; actual_refund BIGINT; actual_shipping BIGINT; gross BIGINT; net BIGINT;
BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='OrderItem' THEN target:=NEW."orderId";
 ELSIF TG_TABLE_NAME='Refund' THEN target:=NEW."orderId";
 ELSIF TG_TABLE_NAME='OrderReturn' THEN SELECT "orderId" INTO target FROM "OrderItem" WHERE id=NEW."orderItemId";
 ELSE SELECT "orderId" INTO target FROM "Refund" WHERE id=NEW."refundId"; END IF;
 SELECT * INTO parent FROM "Order" WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COALESCE(sum("amountCents"),0),COALESCE(sum(CASE WHEN "allocationConfirmed" THEN "shippingCents" ELSE 0 END),0) INTO actual_refund,actual_shipping FROM "Refund" WHERE "orderId"=target AND status='SUCCEEDED';
 IF actual_refund<>parent."refundedCents" OR actual_shipping<>parent."shippingRefundedCents" THEN RAISE EXCEPTION 'Refund ledger and order totals differ' USING ERRCODE='23514'; END IF;
 IF parent."subtotalCents" IS NOT NULL AND EXISTS(SELECT 1 FROM "OrderItem" WHERE "orderId"=target) THEN
  SELECT sum((price*quantity*100)::bigint),sum("netCents") INTO gross,net FROM "OrderItem" WHERE "orderId"=target;
  IF gross<>parent."subtotalCents" OR net IS DISTINCT FROM parent."subtotalCents"-parent."discountCents" OR EXISTS(SELECT 1 FROM "OrderItem" WHERE "orderId"=target AND "netCents" IS NULL) THEN RAISE EXCEPTION 'Purchase pricing snapshot is incomplete' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM "Refund" r WHERE r."orderId"=target AND r."allocationConfirmed" AND r."amountCents"<>r."shippingCents"+COALESCE((SELECT sum(l."amountCents") FROM "RefundLine" l WHERE l."refundId"=r.id),0)) THEN RAISE EXCEPTION 'Refund allocation does not match its amount' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "RefundLine" l JOIN "Refund" r ON r.id=l."refundId" JOIN "OrderItem" i ON i.id=l."orderItemId" WHERE r."orderId"=target AND (i."orderId"<>r."orderId" OR l."offset"+l.quantity>i.quantity)) THEN RAISE EXCEPTION 'Refund allocation belongs to another purchase' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "OrderItem" i WHERE i."orderId"=target AND (i."refundedCents"<>COALESCE((SELECT sum(l."amountCents") FROM "RefundLine" l JOIN "Refund" r ON r.id=l."refundId" WHERE l."orderItemId"=i.id AND r.status='SUCCEEDED' AND r."allocationConfirmed"),0) OR i."refundedQuantity"<>COALESCE((SELECT sum(l.quantity) FROM "RefundLine" l JOIN "Refund" r ON r.id=l."refundId" WHERE l."orderItemId"=i.id AND r.status='SUCCEEDED' AND r."allocationConfirmed"),0))) THEN RAISE EXCEPTION 'Item refund counters differ from the ledger' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "OrderItem" i WHERE i."orderId"=target AND (i."returnedQuantity"<>COALESCE((SELECT sum(r.quantity) FROM "OrderReturn" r WHERE r."orderItemId"=i.id),0) OR i."voidedQuantity"<>COALESCE((SELECT max(l."offset"+l.quantity) FROM "RefundLine" l JOIN "Refund" r ON r.id=l."refundId" WHERE l."orderItemId"=i.id AND l."beforeDispatch" AND r."appliedAt" IS NOT NULL),0))) THEN RAISE EXCEPTION 'Inventory counters differ from retained refund or return evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Order_finances_consistent" AFTER INSERT OR UPDATE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_finances();
CREATE CONSTRAINT TRIGGER "OrderItem_finances_consistent" AFTER INSERT OR UPDATE ON "OrderItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_finances();
CREATE CONSTRAINT TRIGGER "Refund_finances_consistent" AFTER INSERT OR UPDATE ON "Refund" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_finances();
CREATE CONSTRAINT TRIGGER "RefundLine_finances_consistent" AFTER INSERT ON "RefundLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_finances();
CREATE CONSTRAINT TRIGGER "OrderReturn_finances_consistent" AFTER INSERT ON "OrderReturn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_order_finances();

-- Fully voided packages are closed by the refund workflow; their noncancelled
-- siblings still contribute their actual fulfillment state.
CREATE OR REPLACE FUNCTION aggregate_order_fulfillments(target TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN count(*)=0 THEN CASE WHEN EXISTS(SELECT 1 FROM "OrderItem" WHERE "orderId"=target) THEN 'CANCELLED' ELSE NULL END
 WHEN bool_and(f.status='CANCELLED') THEN 'CANCELLED'
 WHEN bool_or(f.status='CANCELLED') THEN 'INVALID_PARTIAL_CANCELLATION'
 WHEN bool_and(f.status='DELIVERED') THEN 'DELIVERED' WHEN bool_or(f.status='DELIVERED') THEN 'PARTIALLY_DELIVERED'
 WHEN bool_and(f.status='SHIPPED') THEN 'SHIPPED' WHEN bool_or(f.status='SHIPPED') THEN 'PARTIALLY_SHIPPED'
 WHEN bool_and(f.status='PENDING') THEN 'PENDING' ELSE 'PROCESSING' END
 FROM "OrderFulfillment" f WHERE f."orderId"=target AND EXISTS(SELECT 1 FROM "OrderItem" i WHERE i."fulfillmentId"=f.id AND i.quantity>i."voidedQuantity")
$$;
CREATE OR REPLACE FUNCTION sync_order_fulfillment_state() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE mixed BOOLEAN;
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED') THEN
  IF NEW.status='CANCELLED' AND EXISTS(SELECT 1 FROM "OrderFulfillment" WHERE "orderId"=NEW.id AND status IN ('SHIPPED','DELIVERED')) THEN RAISE EXCEPTION 'Dispatched orders require reconciliation' USING ERRCODE='23514'; END IF;
  UPDATE "OrderFulfillment" SET status=NEW.status,version=version+1,"updatedAt"=timezone('UTC',clock_timestamp()),
   "shippedAt"=CASE WHEN NEW.status='SHIPPED' THEN COALESCE("shippedAt",timezone('UTC',clock_timestamp())) ELSE "shippedAt" END,
   "deliveredAt"=CASE WHEN NEW.status='DELIVERED' THEN COALESCE("deliveredAt",timezone('UTC',clock_timestamp())) ELSE "deliveredAt" END,
   "codCollected"=CASE WHEN NEW.status='DELIVERED' AND NEW."paymentMethod"='COD' AND NEW."paymentStatus"='PAID' THEN true ELSE "codCollected" END,
   "codCollectedAt"=CASE WHEN NEW.status='DELIVERED' AND NEW."paymentMethod"='COD' AND NEW."paymentStatus"='PAID' THEN COALESCE("codCollectedAt",timezone('UTC',clock_timestamp())) ELSE "codCollectedAt" END
  WHERE "orderId"=NEW.id AND status<>NEW.status AND EXISTS(SELECT 1 FROM "OrderItem" i WHERE i."fulfillmentId"="OrderFulfillment".id AND i.quantity>i."voidedQuantity");
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

CREATE OR REPLACE FUNCTION review_purchase_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase_user TEXT; purchase_product TEXT; delivery TEXT; payment TEXT; method TEXT; collected BOOLEAN; seller TEXT; retained INTEGER; net BIGINT; remaining BIGINT; review_reason TEXT; dispute TEXT; order_state TEXT;
BEGIN
 IF NEW."orderItemId" IS NULL THEN RETURN NEW; END IF;
 SELECT o."userId",i."productId",f.status,o."paymentStatus",o."paymentMethod",f."codCollected",f."sellerId",i."retainedQuantity",i."netCents",i."retainedCents",o."financialReviewReason",o."disputeStatus",o.status
 INTO purchase_user,purchase_product,delivery,payment,method,collected,seller,retained,net,remaining,review_reason,dispute,order_state
 FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" JOIN "OrderFulfillment" f ON f.id=i."fulfillmentId" WHERE i.id=NEW."orderItemId" FOR SHARE OF o,i;
 IF NOT FOUND OR purchase_user<>NEW."userId" OR purchase_product<>NEW."productId" OR seller=NEW."userId" THEN RAISE EXCEPTION 'Review purchase association is invalid' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('PENDING','PUBLISHED') AND (delivery<>'DELIVERED' OR order_state='CANCELLED' OR retained<=0 OR (net>0 AND remaining<=0) OR review_reason IS NOT NULL OR dispute IN ('ACTIVE','LOST') OR NOT ((method='STRIPE' AND payment='PAID') OR (method='COD' AND collected))) THEN RAISE EXCEPTION 'Review requires a retained delivered paid purchase' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION record_fulfillment_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE label TEXT; prior TEXT; instant TIMESTAMP(3):=timezone('UTC',clock_timestamp());
BEGIN
 IF TG_OP='INSERT' THEN label:=CASE WHEN NEW."legacySnapshot" THEN 'LEGACY_SNAPSHOT' ELSE 'SHIPMENT_CREATED' END;
 ELSE
  prior:=OLD.status;
  label:=CASE WHEN NEW.status<>OLD.status THEN 'SHIPMENT_'||NEW.status WHEN NEW."codCollected" IS DISTINCT FROM OLD."codCollected" THEN 'COD_COLLECTED' WHEN current_setting('amar.fulfillment_adjustment',true)='true' THEN 'SHIPMENT_ADJUSTED' ELSE 'SHIPMENT_UPDATED' END;
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

COMMIT;
