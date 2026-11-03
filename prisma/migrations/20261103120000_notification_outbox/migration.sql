BEGIN;
CREATE TABLE "NotificationEvent" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,"dedupeKey" VARCHAR(240) NOT NULL UNIQUE,kind VARCHAR(40) NOT NULL,
 audience VARCHAR(16) NOT NULL CHECK(audience IN ('ACCOUNT','SELLER','ADMIN')),
 "recipientGroup" VARCHAR(24) NOT NULL CHECK("recipientGroup" IN ('DIRECT','ADMINS','ORDER_SELLERS','SELLERS')),
 "recipientId" VARCHAR(64),"subjectType" VARCHAR(24) NOT NULL CHECK("subjectType" IN ('ACCOUNT','PRODUCT','ORDER','FULFILLMENT','PAYOUT','POLICY')),
 "subjectId" VARCHAR(64) NOT NULL,data JSONB NOT NULL CHECK(jsonb_typeof(data)='object'),
 state VARCHAR(16) NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','PROCESSING','RETRY','DELIVERED','SKIPPED','DEAD')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),"claimCount" INTEGER NOT NULL DEFAULT 0 CHECK("claimCount">=0),
 "cursorId" VARCHAR(64),"nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),"leaseToken" VARCHAR(36),"leaseUntil" TIMESTAMP(3),"lastErrorCode" VARCHAR(80),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "NotificationEvent_target" CHECK(("recipientGroup"='DIRECT' AND "recipientId" IS NOT NULL) OR ("recipientGroup"<>'DIRECT' AND "recipientId" IS NULL)),
 CONSTRAINT "NotificationEvent_audience" CHECK(("recipientGroup"='ADMINS' AND audience='ADMIN') OR ("recipientGroup" IN ('ORDER_SELLERS','SELLERS') AND audience='SELLER') OR "recipientGroup"='DIRECT'),
 CONSTRAINT "NotificationEvent_kind" CHECK(kind IN ('SELLER_APPLICATION','SELLER_STATUS','ACCOUNT_ACCESS','PRODUCT_REVIEW','PRODUCT_STATUS','ORDER_PLACED','ORDER_STATUS','PAYMENT_STATUS','SHIPMENT_ASSIGNED','SHIPMENT_STATUS','REFUND_STATUS','DISPUTE_STATUS','PAYOUT_STATUS','COMMERCIAL_POLICY')),
 CONSTRAINT "NotificationEvent_lease" CHECK((state='PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (state<>'PROCESSING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL))
);
CREATE INDEX "NotificationEvent_state_nextAttemptAt_id_idx" ON "NotificationEvent"(state,"nextAttemptAt",id);
CREATE INDEX "NotificationEvent_state_leaseUntil_idx" ON "NotificationEvent"(state,"leaseUntil");
CREATE TABLE "Notification" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,"eventId" TEXT NOT NULL REFERENCES "NotificationEvent"(id) ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,audience VARCHAR(16) NOT NULL CHECK(audience IN ('ACCOUNT','SELLER','ADMIN')),kind VARCHAR(40) NOT NULL,
 title VARCHAR(120) NOT NULL CHECK(length(title)>0),body VARCHAR(600) NOT NULL CHECK(length(body)>0),href VARCHAR(200) NOT NULL,
 "occurredAt" TIMESTAMP(3) NOT NULL,"readAt" TIMESTAMP(3),"readVersion" INTEGER NOT NULL DEFAULT 0 CHECK("readVersion">=0),"deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "Notification_href" CHECK(href IN ('/admin/members','/admin/products','/admin/orders','/admin/settlements','/member/dashboard','/member/products','/member/orders','/member/earnings','/member/payouts','/user/orders','/user/profile'))
);
CREATE UNIQUE INDEX "Notification_eventId_userId_key" ON "Notification"("eventId","userId");
CREATE INDEX "Notification_userId_audience_occurredAt_id_idx" ON "Notification"("userId",audience,"occurredAt",id);
CREATE INDEX "Notification_userId_audience_readAt_occurredAt_id_idx" ON "Notification"("userId",audience,"readAt","occurredAt",id);
CREATE TABLE "NotificationRetryEvent"(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,"eventId" TEXT NOT NULL REFERENCES "NotificationEvent"(id) ON DELETE RESTRICT,
 "actorId" VARCHAR(64) NOT NULL,reason VARCHAR(500) NOT NULL CHECK(length(trim(reason))>=5),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
CREATE INDEX "NotificationRetryEvent_eventId_createdAt_idx" ON "NotificationRetryEvent"("eventId","createdAt");

CREATE FUNCTION guard_notification_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification delivery evidence is retained' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW."dedupeKey",NEW.kind,NEW.audience,NEW."recipientGroup",NEW."recipientId",NEW."subjectType",NEW."subjectId",NEW.data,NEW."createdAt")
  IS DISTINCT FROM ROW(OLD.id,OLD."dedupeKey",OLD.kind,OLD.audience,OLD."recipientGroup",OLD."recipientId",OLD."subjectType",OLD."subjectId",OLD.data,OLD."createdAt")
  OR NEW.version<>OLD.version+1 OR NEW."claimCount"<OLD."claimCount"
  OR (OLD."cursorId" IS NOT NULL AND (NEW."cursorId" IS NULL OR NEW."cursorId" COLLATE "C"<OLD."cursorId" COLLATE "C")) THEN
  RAISE EXCEPTION 'Notification event content is immutable and progress needs the next revision' USING ERRCODE='23514';
 END IF;
 NEW."updatedAt":=timezone('UTC',clock_timestamp()); RETURN NEW;
END $$;
CREATE TRIGGER "NotificationEvent_guard" BEFORE UPDATE OR DELETE ON "NotificationEvent" FOR EACH ROW EXECUTE FUNCTION guard_notification_event();
CREATE FUNCTION guard_notification_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "NotificationEvent"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=OLD."userId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Delivered notification content is retained' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO source FROM "NotificationEvent" WHERE id=NEW."eventId";
  IF source.id IS NULL OR source.state<>'PROCESSING' OR source."leaseUntil"<=timezone('UTC',clock_timestamp())
   OR NEW.audience<>source.audience OR NEW.kind<>source.kind OR NEW."occurredAt"<>source."createdAt" OR NEW."readAt" IS NOT NULL OR NEW."readVersion"<>0
   OR (source."recipientGroup"='DIRECT' AND NEW."userId"<>source."recipientId") THEN
   RAISE EXCEPTION 'Notification delivery must match its actual source and recipient' USING ERRCODE='23514';
  END IF;
  IF source."recipientGroup"='ADMINS' AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."userId" AND role='ADMIN' AND "isVerified") THEN
   RAISE EXCEPTION 'Administrator notification recipient is not currently authorized' USING ERRCODE='23514';
  END IF;
  IF source."recipientGroup"='ORDER_SELLERS' AND NOT EXISTS(SELECT 1 FROM "OrderFulfillment" WHERE "orderId"=source."subjectId" AND "sellerId"=NEW."userId") THEN
   RAISE EXCEPTION 'Seller notification recipient is not captured on this order' USING ERRCODE='23514';
  END IF;
  IF source."recipientGroup"='SELLERS' AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=NEW."userId" AND u."isVerified" AND (u.role='MEMBER' OR (u.role='ADMIN' AND EXISTS(SELECT 1 FROM "Product" WHERE "sellerId"=u.id)))) THEN
   RAISE EXCEPTION 'Commercial notification recipient is not a current catalog owner' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW."eventId",NEW."userId",NEW.audience,NEW.kind,NEW.title,NEW.body,NEW.href,NEW."occurredAt",NEW."deliveredAt")
   IS DISTINCT FROM ROW(OLD.id,OLD."eventId",OLD."userId",OLD.audience,OLD.kind,OLD.title,OLD.body,OLD.href,OLD."occurredAt",OLD."deliveredAt") OR NEW."readVersion"<>OLD."readVersion"+1 THEN
   RAISE EXCEPTION 'Delivered content is immutable and read state needs the next revision' USING ERRCODE='23514';
  END IF;
  NEW."readAt":=CASE WHEN NEW."readAt" IS NULL THEN NULL ELSE timezone('UTC',clock_timestamp()) END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Notification_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Notification" FOR EACH ROW EXECUTE FUNCTION guard_notification_message();
CREATE FUNCTION retain_notification_retry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Notification retry evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "NotificationRetryEvent_immutable" BEFORE UPDATE OR DELETE ON "NotificationRetryEvent" FOR EACH ROW EXECUTE FUNCTION retain_notification_retry();

CREATE FUNCTION enqueue_notification(dedupe TEXT,category TEXT,target_audience TEXT,recipients TEXT,recipient TEXT,subject_type TEXT,subject TEXT,payload JSONB) RETURNS void LANGUAGE plpgsql AS $$
DECLARE existing "NotificationEvent"%ROWTYPE;
BEGIN
 INSERT INTO "NotificationEvent"("dedupeKey",kind,audience,"recipientGroup","recipientId","subjectType","subjectId",data)
  VALUES(dedupe,category,target_audience,recipients,recipient,subject_type,subject,payload) ON CONFLICT("dedupeKey") DO NOTHING;
 SELECT * INTO existing FROM "NotificationEvent" WHERE "dedupeKey"=dedupe;
 IF ROW(existing.kind,existing.audience,existing."recipientGroup",existing."recipientId",existing."subjectType",existing."subjectId",existing.data)
  IS DISTINCT FROM ROW(category,target_audience,recipients,recipient,subject_type,subject,payload) THEN
  RAISE EXCEPTION 'Notification source identity cannot represent different content' USING ERRCODE='23514';
 END IF;
END $$;

CREATE FUNCTION notification_account_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prefix TEXT:='account:'||NEW.id||':'||NEW."administrationVersion"::text||':'; applied BOOLEAN;
BEGIN
 applied:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN applied:=NEW."isVerified" IS DISTINCT FROM OLD."isVerified" OR NEW.role IS DISTINCT FROM OLD.role OR NEW."sellerStatus" IS DISTINCT FROM OLD."sellerStatus"; END IF;
 IF NOT applied THEN RETURN NULL; END IF;
 IF NEW.role='MEMBER' AND NEW."isVerified" AND NEW."sellerStatus"='PENDING' THEN
  PERFORM enqueue_notification(prefix||'application','SELLER_APPLICATION','ADMIN','ADMINS',NULL,'ACCOUNT',NEW.id,'{}');
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.role='MEMBER' AND NEW."sellerStatus" IS DISTINCT FROM OLD."sellerStatus" THEN PERFORM enqueue_notification(prefix||'status','SELLER_STATUS','SELLER','DIRECT',NEW.id,'ACCOUNT',NEW.id,jsonb_build_object('status',NEW."sellerStatus")); END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW."isVerified" IS DISTINCT FROM OLD."isVerified" THEN PERFORM enqueue_notification(prefix||'access','ACCOUNT_ACCESS','ACCOUNT','DIRECT',NEW.id,'ACCOUNT',NEW.id,'{}'); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "User_notification_source" AFTER INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION notification_account_source();

CREATE FUNCTION notification_product_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed BOOLEAN; prefix TEXT:='product:'||NEW.id||':'||NEW."catalogVersion"::text||':';
BEGIN
 changed:=TG_OP='INSERT'; IF TG_OP='UPDATE' THEN changed:=NEW."catalogVersion"<>OLD."catalogVersion"; END IF;
 IF changed AND NEW.status='PENDING_APPROVAL' THEN PERFORM enqueue_notification(prefix||'review','PRODUCT_REVIEW','ADMIN','ADMINS',NULL,'PRODUCT',NEW.id,'{}'); END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('APPROVED','REJECTED','ARCHIVED') THEN PERFORM enqueue_notification(prefix||'status','PRODUCT_STATUS','SELLER','DIRECT',NEW."sellerId",'PRODUCT',NEW.id,jsonb_build_object('status',NEW.status)); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "Product_notification_source" AFTER INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION notification_product_source();

CREATE FUNCTION notification_order_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE buyer TEXT; prefix TEXT:='order-event:'||NEW.id||':';
BEGIN
 SELECT "userId" INTO buyer FROM "Order" WHERE id=NEW."orderId";
 IF buyer IS NULL THEN RETURN NULL; END IF;
 IF NEW.kind='ORDER_PLACED' THEN
  PERFORM enqueue_notification(prefix||'placed:account','ORDER_PLACED','ACCOUNT','DIRECT',buyer,'ORDER',NEW."orderId",'{}');
  PERFORM enqueue_notification(prefix||'placed:admin','ORDER_PLACED','ADMIN','ADMINS',NULL,'ORDER',NEW."orderId",'{}');
 ELSIF NEW.kind='STATE_CHANGED' THEN
  IF NEW.status IS DISTINCT FROM NEW."previousStatus" THEN PERFORM enqueue_notification(prefix||'status','ORDER_STATUS','ACCOUNT','DIRECT',buyer,'ORDER',NEW."orderId",jsonb_build_object('status',NEW.status)); END IF;
 END IF;
 IF NEW.kind IN ('ORDER_PLACED','STATE_CHANGED') AND NEW."paymentStatus" IN ('PAID','FAILED') AND NEW."paymentStatus" IS DISTINCT FROM NEW."previousPaymentStatus" THEN
  PERFORM enqueue_notification(prefix||'payment:account','PAYMENT_STATUS','ACCOUNT','DIRECT',buyer,'ORDER',NEW."orderId",jsonb_build_object('status',NEW."paymentStatus"));
  PERFORM enqueue_notification(prefix||'payment:seller','PAYMENT_STATUS','SELLER','ORDER_SELLERS',NULL,'ORDER',NEW."orderId",jsonb_build_object('status',NEW."paymentStatus"));
  PERFORM enqueue_notification(prefix||'payment:admin','PAYMENT_STATUS','ADMIN','ADMINS',NULL,'ORDER',NEW."orderId",jsonb_build_object('status',NEW."paymentStatus"));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "OrderEvent_notification_source" AFTER INSERT ON "OrderEvent" FOR EACH ROW EXECUTE FUNCTION notification_order_source();

CREATE FUNCTION notification_shipment_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vendor TEXT; category TEXT;
BEGIN
 IF NEW.kind IN ('LEGACY_SNAPSHOT','SHIPMENT_UPDATED','SHIPMENT_ADJUSTED') THEN RETURN NULL; END IF;
 SELECT "sellerId" INTO vendor FROM "OrderFulfillment" WHERE id=NEW."fulfillmentId";
 IF vendor IS NULL THEN RETURN NULL; END IF;
 category:=CASE WHEN NEW.kind='SHIPMENT_CREATED' THEN 'SHIPMENT_ASSIGNED' ELSE 'SHIPMENT_STATUS' END;
 PERFORM enqueue_notification('shipment-event:'||NEW.id,category,'SELLER','DIRECT',vendor,'FULFILLMENT',NEW."fulfillmentId",jsonb_build_object('status',CASE WHEN NEW.kind='COD_COLLECTED' THEN 'COD_COLLECTED' ELSE NEW.status END));
 RETURN NULL;
END $$;
CREATE TRIGGER "FulfillmentEvent_notification_source" AFTER INSERT ON "FulfillmentEvent" FOR EACH ROW EXECUTE FUNCTION notification_shipment_source();

CREATE FUNCTION notification_refund_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE buyer TEXT; prefix TEXT:='refund:'||NEW.id||':'||NEW.version::text||':';
BEGIN
 IF TG_OP='UPDATE' THEN IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF; END IF;
 SELECT "userId" INTO buyer FROM "Order" WHERE id=NEW."orderId";
 IF buyer IS NULL THEN RETURN NULL; END IF;
 PERFORM enqueue_notification(prefix||'account','REFUND_STATUS','ACCOUNT','DIRECT',buyer,'ORDER',NEW."orderId",jsonb_build_object('status',NEW.status));
 PERFORM enqueue_notification(prefix||'seller','REFUND_STATUS','SELLER','ORDER_SELLERS',NULL,'ORDER',NEW."orderId",jsonb_build_object('status',NEW.status));
 PERFORM enqueue_notification(prefix||'admin','REFUND_STATUS','ADMIN','ADMINS',NULL,'ORDER',NEW."orderId",jsonb_build_object('status',NEW.status));
 RETURN NULL;
END $$;
CREATE TRIGGER "Refund_notification_source" AFTER INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION notification_refund_source();
CREATE FUNCTION notification_dispute_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE buyer TEXT;
BEGIN
 IF NEW.kind<>'PAYMENT_DISPUTE_RECONCILED' THEN RETURN NULL; END IF;
 SELECT "userId" INTO buyer FROM "Order" WHERE id=NEW."orderId";
 IF buyer IS NULL THEN RETURN NULL; END IF;
 PERFORM enqueue_notification('finance:'||NEW.id||':account','DISPUTE_STATUS','ACCOUNT','DIRECT',buyer,'ORDER',NEW."orderId",'{}');
 PERFORM enqueue_notification('finance:'||NEW.id||':seller','DISPUTE_STATUS','SELLER','ORDER_SELLERS',NULL,'ORDER',NEW."orderId",'{}');
 PERFORM enqueue_notification('finance:'||NEW.id||':admin','DISPUTE_STATUS','ADMIN','ADMINS',NULL,'ORDER',NEW."orderId",'{}');
 RETURN NULL;
END $$;
CREATE TRIGGER "FinancialEvent_notification_source" AFTER INSERT ON "FinancialEvent" FOR EACH ROW EXECUTE FUNCTION notification_dispute_source();
CREATE FUNCTION notification_payout_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vendor TEXT;
BEGIN
 SELECT "sellerId" INTO vendor FROM "SellerPayout" WHERE id=NEW."payoutId";
 IF vendor IS NOT NULL THEN PERFORM enqueue_notification('payout-event:'||NEW.id,'PAYOUT_STATUS','SELLER','DIRECT',vendor,'PAYOUT',NEW."payoutId",jsonb_build_object('status',NEW.status)); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "SellerPayoutEvent_notification_source" AFTER INSERT ON "SellerPayoutEvent" FOR EACH ROW EXECUTE FUNCTION notification_payout_source();
CREATE FUNCTION notification_commercial_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM enqueue_notification('commercial-policy:'||NEW.id,'COMMERCIAL_POLICY','SELLER',CASE WHEN NEW."scopeKey"='GLOBAL' THEN 'SELLERS' ELSE 'DIRECT' END,
  CASE WHEN NEW."scopeKey"='GLOBAL' THEN NULL ELSE substring(NEW."scopeKey" FROM 8) END,'POLICY',NEW.id,'{}');
 RETURN NULL;
END $$;
CREATE TRIGGER "SellerSettlementPolicy_notification_source" AFTER INSERT ON "SellerSettlementPolicy" FOR EACH ROW EXECUTE FUNCTION notification_commercial_source();
-- Do not backfill old source events as new notifications or invent prior delivery.
COMMIT;
