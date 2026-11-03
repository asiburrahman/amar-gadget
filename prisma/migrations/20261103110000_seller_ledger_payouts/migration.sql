BEGIN;
CREATE TABLE "SellerWallet"("sellerId" VARCHAR(64) PRIMARY KEY,"balanceCents" BIGINT NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0));
CREATE TABLE "SellerAccrual"("fulfillmentId" VARCHAR(64) PRIMARY KEY,"orderId" VARCHAR(64) NOT NULL,"sellerId" VARCHAR(64) NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"targetCents" BIGINT NOT NULL CHECK("targetCents">=0),projection JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
CREATE INDEX "SellerAccrual_orderId_idx" ON "SellerAccrual"("orderId");
CREATE INDEX "SellerAccrual_sellerId_createdAt_fulfillmentId_idx" ON "SellerAccrual"("sellerId","createdAt","fulfillmentId");
CREATE TABLE "SellerPayout"(id TEXT PRIMARY KEY,"sellerId" VARCHAR(64) NOT NULL,"amountCents" BIGINT NOT NULL CHECK("amountCents">0),
 method VARCHAR(30) NOT NULL CHECK(length(trim(method))>=2),status VARCHAR(16) NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','PAID','CANCELLED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" VARCHAR(64) NOT NULL,reason VARCHAR(500) NOT NULL CHECK(length(trim(reason))>=5),
 reference VARCHAR(120),"resolvedById" VARCHAR(64),"resolutionReason" VARCHAR(500),"moneyNotSent" BOOLEAN,"resolvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
CREATE INDEX "SellerPayout_sellerId_createdAt_id_idx" ON "SellerPayout"("sellerId","createdAt",id);
CREATE INDEX "SellerPayout_status_createdAt_id_idx" ON "SellerPayout"(status,"createdAt",id);
CREATE UNIQUE INDEX "SellerPayout_external_reference" ON "SellerPayout"(method,reference) WHERE status='PAID';
CREATE TABLE "SellerLedgerEntry"(id TEXT PRIMARY KEY,sequence BIGSERIAL NOT NULL UNIQUE,"sellerId" VARCHAR(64) NOT NULL,
 kind VARCHAR(24) NOT NULL CHECK(kind IN ('ENTITLEMENT','PAYOUT_RESERVE','PAYOUT_RELEASE')),"deltaCents" BIGINT NOT NULL CHECK("deltaCents"<>0),
 "fulfillmentId" VARCHAR(64),"accrualVersion" INTEGER,"payoutId" VARCHAR(64),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "SellerLedgerEntry_kind" CHECK((kind='ENTITLEMENT' AND "fulfillmentId" IS NOT NULL AND "accrualVersion" IS NOT NULL AND "accrualVersion">0 AND "payoutId" IS NULL)
  OR (kind IN ('PAYOUT_RESERVE','PAYOUT_RELEASE') AND "payoutId" IS NOT NULL AND "fulfillmentId" IS NULL AND "accrualVersion" IS NULL)));
CREATE UNIQUE INDEX "SellerLedgerEntry_fulfillmentId_accrualVersion_key" ON "SellerLedgerEntry"("fulfillmentId","accrualVersion");
CREATE UNIQUE INDEX "SellerLedgerEntry_payoutId_kind_key" ON "SellerLedgerEntry"("payoutId",kind);
CREATE INDEX "SellerLedgerEntry_sellerId_sequence_idx" ON "SellerLedgerEntry"("sellerId",sequence);
CREATE TABLE "SellerPayoutEvent"(id TEXT PRIMARY KEY,sequence BIGSERIAL NOT NULL UNIQUE,"payoutId" VARCHAR(64) NOT NULL,"actorId" VARCHAR(64) NOT NULL,
 "previousStatus" VARCHAR(16),status VARCHAR(16) NOT NULL,reason VARCHAR(500) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
CREATE INDEX "SellerPayoutEvent_payoutId_sequence_idx" ON "SellerPayoutEvent"("payoutId",sequence);
CREATE TABLE "SellerSettlementRequest"(id VARCHAR(36) PRIMARY KEY,"actorId" VARCHAR(64) NOT NULL,hash VARCHAR(64) NOT NULL CHECK(length(hash)=64),
 result JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));

CREATE FUNCTION retain_seller_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Seller financial evidence is retained and append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "SellerLedgerEntry_immutable" BEFORE UPDATE OR DELETE ON "SellerLedgerEntry" FOR EACH ROW EXECUTE FUNCTION retain_seller_evidence();
CREATE TRIGGER "SellerPayoutEvent_immutable" BEFORE UPDATE OR DELETE ON "SellerPayoutEvent" FOR EACH ROW EXECUTE FUNCTION retain_seller_evidence();
CREATE TRIGGER "SellerSettlementRequest_immutable" BEFORE UPDATE OR DELETE ON "SellerSettlementRequest" FOR EACH ROW EXECUTE FUNCTION retain_seller_evidence();
CREATE TRIGGER "SellerWallet_retained" BEFORE DELETE ON "SellerWallet" FOR EACH ROW EXECUTE FUNCTION retain_seller_evidence();
CREATE TRIGGER "SellerAccrual_retained" BEFORE DELETE ON "SellerAccrual" FOR EACH ROW EXECUTE FUNCTION retain_seller_evidence();
CREATE FUNCTION guard_seller_accrual() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."fulfillmentId",NEW."orderId",NEW."sellerId",NEW."createdAt") IS DISTINCT FROM ROW(OLD."fulfillmentId",OLD."orderId",OLD."sellerId",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Seller accrual ownership is immutable and needs the next revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SellerAccrual_guard" BEFORE UPDATE ON "SellerAccrual" FOR EACH ROW EXECUTE FUNCTION guard_seller_accrual();

CREATE FUNCTION guard_seller_ledger_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target "SellerAccrual"%ROWTYPE; payout "SellerPayout"%ROWTYPE; prior NUMERIC;
BEGIN
 IF NEW.kind='ENTITLEMENT' THEN
  SELECT * INTO target FROM "SellerAccrual" WHERE "fulfillmentId"=NEW."fulfillmentId";
  SELECT COALESCE(sum("deltaCents"),0) INTO prior FROM "SellerLedgerEntry" WHERE "fulfillmentId"=NEW."fulfillmentId";
  IF target."fulfillmentId" IS NULL OR target."sellerId"<>NEW."sellerId" OR target.version<>NEW."accrualVersion" OR NEW."deltaCents"<>target."targetCents"-prior THEN
   RAISE EXCEPTION 'Seller credit does not match the current purchase entitlement' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO payout FROM "SellerPayout" WHERE id=NEW."payoutId";
  IF payout.id IS NULL OR payout."sellerId"<>NEW."sellerId"
   OR (NEW.kind='PAYOUT_RESERVE' AND NEW."deltaCents"<>-payout."amountCents")
   OR (NEW.kind='PAYOUT_RELEASE' AND (payout.status<>'CANCELLED' OR NEW."deltaCents"<>payout."amountCents")) THEN
   RAISE EXCEPTION 'Seller debit does not match an actual payout reservation' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SellerLedgerEntry_guard" BEFORE INSERT ON "SellerLedgerEntry" FOR EACH ROW EXECUTE FUNCTION guard_seller_ledger_entry();
CREATE FUNCTION post_seller_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "SellerWallet"("sellerId","balanceCents",version) VALUES(NEW."sellerId",NEW."deltaCents",1)
  ON CONFLICT("sellerId") DO UPDATE SET "balanceCents"="SellerWallet"."balanceCents"+EXCLUDED."balanceCents",version="SellerWallet".version+1;
 RETURN NULL;
END $$;
CREATE TRIGGER "SellerLedgerEntry_post" AFTER INSERT ON "SellerLedgerEntry" FOR EACH ROW EXECUTE FUNCTION post_seller_wallet();

CREATE FUNCTION guard_seller_payout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance BIGINT; actor TEXT;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payout instructions and confirmations are retained' USING ERRCODE='23514'; END IF;
 NEW.method:=upper(trim(NEW.method));
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'RESERVED' OR NEW.version<>1 OR NEW.reference IS NOT NULL OR NEW."resolvedById" IS NOT NULL OR NEW."resolutionReason" IS NOT NULL OR NEW."moneyNotSent" IS NOT NULL OR NEW."resolvedAt" IS NOT NULL THEN
   RAISE EXCEPTION 'A payout starts only as an unconfirmed reservation' USING ERRCODE='23514';
  END IF;
  actor:=NEW."createdById";
  IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."sellerId" AND role IN ('MEMBER','ADMIN') AND "isVerified" AND "sellerStatus"='APPROVED') THEN
   RAISE EXCEPTION 'An approved seller account is required for payout' USING ERRCODE='23514';
  END IF;
  INSERT INTO "SellerWallet"("sellerId") VALUES(NEW."sellerId") ON CONFLICT DO NOTHING;
  SELECT "balanceCents" INTO balance FROM "SellerWallet" WHERE "sellerId"=NEW."sellerId" FOR UPDATE;
  IF NEW."amountCents"<=0 OR balance<NEW."amountCents" THEN RAISE EXCEPTION 'Insufficient available seller balance' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW."sellerId",NEW."amountCents",NEW.method,NEW."createdById",NEW.reason,NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."sellerId",OLD."amountCents",OLD.method,OLD."createdById",OLD.reason,OLD."createdAt")
   OR OLD.status<>'RESERVED' OR NEW.status NOT IN ('PAID','CANCELLED') OR NEW.version<>OLD.version+1 OR NEW."resolvedById" IS NULL
   OR NEW."resolutionReason" IS NULL OR length(trim(NEW."resolutionReason"))<5 THEN
   RAISE EXCEPTION 'Payout intent is immutable and needs the observed next resolution revision' USING ERRCODE='23514';
  END IF;
  IF NEW.status='PAID' THEN
   IF NEW.reference IS NULL OR length(trim(NEW.reference))<3 OR NEW."moneyNotSent" IS NOT NULL THEN RAISE EXCEPTION 'External payment confirmation requires its reference' USING ERRCODE='23514'; END IF;
   NEW.reference:=upper(trim(NEW.reference));
  ELSIF NEW.reference IS NOT NULL OR NEW."moneyNotSent" IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Cancellation requires an explicit declaration that no money was sent' USING ERRCODE='23514';
  END IF;
  NEW."resolvedAt":=timezone('UTC',clock_timestamp()); actor:=NEW."resolvedById";
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=actor AND role='ADMIN' AND "isVerified") THEN RAISE EXCEPTION 'Payout operation requires a verified administrator' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SellerPayout_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SellerPayout" FOR EACH ROW EXECUTE FUNCTION guard_seller_payout();
CREATE FUNCTION record_seller_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "SellerPayoutEvent"(id,"payoutId","actorId","previousStatus",status,reason)
  VALUES(gen_random_uuid()::text,NEW.id,CASE WHEN TG_OP='INSERT' THEN NEW."createdById" ELSE NEW."resolvedById" END,
   CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,CASE WHEN TG_OP='INSERT' THEN NEW.reason ELSE NEW."resolutionReason" END);
 IF TG_OP='INSERT' OR NEW.status='CANCELLED' THEN
  INSERT INTO "SellerLedgerEntry"(id,"sellerId",kind,"deltaCents","payoutId") VALUES(gen_random_uuid()::text,NEW."sellerId",
   CASE WHEN TG_OP='INSERT' THEN 'PAYOUT_RESERVE' ELSE 'PAYOUT_RELEASE' END,CASE WHEN TG_OP='INSERT' THEN -NEW."amountCents" ELSE NEW."amountCents" END,NEW.id);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "SellerPayout_record" AFTER INSERT OR UPDATE ON "SellerPayout" FOR EACH ROW EXECUTE FUNCTION record_seller_payout();

CREATE FUNCTION reconcile_seller_order(target TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE value JSONB; current_row "SellerAccrual"%ROWTYPE; delta BIGINT; next_version INTEGER; vendor TEXT;
BEGIN
 -- Order writers serialize before any seller wallet. Payout reservation locks
 -- only its wallet and never asks for an order lock, avoiding the reverse edge.
 PERFORM 1 FROM "Order" WHERE id=target FOR UPDATE;
 FOR vendor IN SELECT "sellerId" FROM "OrderFulfillment" WHERE "orderId"=target UNION SELECT "sellerId" FROM "SellerAccrual" WHERE "orderId"=target ORDER BY 1 LOOP
  INSERT INTO "SellerWallet"("sellerId") VALUES(vendor) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM "SellerWallet" WHERE "sellerId"=vendor FOR UPDATE;
 END LOOP;
 FOR value IN SELECT * FROM jsonb_array_elements(seller_settlement_projection(target)->'shipments') LOOP
  SELECT * INTO current_row FROM "SellerAccrual" WHERE "fulfillmentId"=value->>'id' FOR UPDATE;
  IF current_row."fulfillmentId" IS NOT NULL AND current_row.projection=value THEN CONTINUE; END IF;
  next_version:=COALESCE(current_row.version,0)+1;
  delta:=(value->>'availableCents')::bigint-COALESCE(current_row."targetCents",0);
  INSERT INTO "SellerAccrual"("fulfillmentId","orderId","sellerId",version,"targetCents",projection) VALUES(value->>'id',target,value->>'sellerId',next_version,(value->>'availableCents')::bigint,value)
   ON CONFLICT("fulfillmentId") DO UPDATE SET version=EXCLUDED.version,"targetCents"=EXCLUDED."targetCents",projection=EXCLUDED.projection,"updatedAt"=timezone('UTC',clock_timestamp());
  IF delta<>0 THEN INSERT INTO "SellerLedgerEntry"(id,"sellerId",kind,"deltaCents","fulfillmentId","accrualVersion") VALUES(gen_random_uuid()::text,value->>'sellerId','ENTITLEMENT',delta,value->>'id',next_version); END IF;
 END LOOP;
 -- Zero-value unpaid fixtures may be removed; actual posted finance evidence
 -- is protected below. Keep a labelled zero projection for any removed source.
 FOR current_row IN SELECT a.* FROM "SellerAccrual" a WHERE a."orderId"=target AND NOT EXISTS(SELECT 1 FROM "OrderFulfillment" f JOIN "OrderItem" i ON i."fulfillmentId"=f.id WHERE f.id=a."fulfillmentId") FOR UPDATE LOOP
  value:=jsonb_build_object('id',current_row."fulfillmentId",'sellerId',current_row."sellerId",'availableCents','0','holds',jsonb_build_array('REMOVED'));
  IF current_row.projection<>value THEN UPDATE "SellerAccrual" SET "targetCents"=0,projection=value,version=version+1,"updatedAt"=timezone('UTC',clock_timestamp()) WHERE "fulfillmentId"=current_row."fulfillmentId"; END IF;
 END LOOP;
END $$;
CREATE FUNCTION refresh_seller_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target TEXT;
BEGIN
 IF TG_TABLE_NAME='Order' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD."orderId" ELSE NEW."orderId" END; END IF;
 PERFORM reconcile_seller_order(target); RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Order_seller_settlement" AFTER INSERT OR UPDATE OR DELETE ON "Order" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refresh_seller_settlement();
CREATE CONSTRAINT TRIGGER "OrderItem_seller_settlement" AFTER INSERT OR UPDATE OR DELETE ON "OrderItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refresh_seller_settlement();
CREATE CONSTRAINT TRIGGER "OrderFulfillment_seller_settlement" AFTER INSERT OR UPDATE OR DELETE ON "OrderFulfillment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refresh_seller_settlement();
CREATE CONSTRAINT TRIGGER "SellerSettlementSnapshot_refresh" AFTER INSERT OR UPDATE ON "SellerSettlementSnapshot" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refresh_seller_settlement();

CREATE FUNCTION validate_seller_money() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance NUMERIC; expected JSONB; target NUMERIC; reserved NUMERIC; released NUMERIC; payout "SellerPayout"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='SellerWallet' THEN
  SELECT COALESCE(sum("deltaCents"),0) INTO balance FROM "SellerLedgerEntry" WHERE "sellerId"=NEW."sellerId";
  IF balance IS DISTINCT FROM (SELECT "balanceCents" FROM "SellerWallet" WHERE "sellerId"=NEW."sellerId") THEN RAISE EXCEPTION 'Seller wallet and immutable ledger differ' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='SellerAccrual' THEN
  SELECT r INTO expected FROM jsonb_array_elements(seller_settlement_projection(NEW."orderId")->'shipments') r WHERE r->>'id'=NEW."fulfillmentId";
  IF expected IS NULL THEN expected:=jsonb_build_object('id',NEW."fulfillmentId",'sellerId',NEW."sellerId",'availableCents','0','holds',jsonb_build_array('REMOVED')); END IF;
  SELECT COALESCE(sum("deltaCents"),0) INTO balance FROM "SellerLedgerEntry" WHERE "fulfillmentId"=NEW."fulfillmentId";
  SELECT "targetCents" INTO target FROM "SellerAccrual" WHERE "fulfillmentId"=NEW."fulfillmentId" AND projection=expected AND "sellerId"=expected->>'sellerId';
  IF target IS NULL OR target IS DISTINCT FROM (expected->>'availableCents')::numeric OR target<>balance THEN RAISE EXCEPTION 'Seller entitlement, current purchase and ledger differ' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO payout FROM "SellerPayout" WHERE id=NEW.id;
  SELECT COALESCE(-sum("deltaCents") FILTER(WHERE kind='PAYOUT_RESERVE'),0),COALESCE(sum("deltaCents") FILTER(WHERE kind='PAYOUT_RELEASE'),0) INTO reserved,released FROM "SellerLedgerEntry" WHERE "payoutId"=NEW.id;
  IF reserved<>payout."amountCents" OR released<>(CASE WHEN payout.status='CANCELLED' THEN payout."amountCents" ELSE 0 END) THEN RAISE EXCEPTION 'Payout and its reserved debit differ' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SellerWallet_balanced" AFTER INSERT OR UPDATE ON "SellerWallet" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_seller_money();
CREATE CONSTRAINT TRIGGER "SellerAccrual_balanced" AFTER INSERT OR UPDATE ON "SellerAccrual" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_seller_money();
CREATE CONSTRAINT TRIGGER "SellerPayout_balanced" AFTER INSERT OR UPDATE ON "SellerPayout" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_seller_money();
CREATE FUNCTION retain_posted_seller_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured TEXT;
BEGIN
 IF TG_TABLE_NAME='Order' THEN
  IF EXISTS(SELECT 1 FROM "SellerAccrual" a JOIN "SellerLedgerEntry" l ON l."fulfillmentId"=a."fulfillmentId" WHERE a."orderId"=OLD.id) THEN RAISE EXCEPTION 'Posted seller purchase evidence is retained' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_TABLE_NAME='OrderItem' THEN captured:=OLD."fulfillmentId"; ELSE captured:=OLD.id; END IF;
  IF EXISTS(SELECT 1 FROM "SellerLedgerEntry" WHERE "fulfillmentId"=captured) THEN RAISE EXCEPTION 'Posted seller shipment evidence is retained' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "Order_seller_retention" BEFORE DELETE ON "Order" FOR EACH ROW EXECUTE FUNCTION retain_posted_seller_purchase();
CREATE TRIGGER "OrderItem_seller_retention" BEFORE DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION retain_posted_seller_purchase();
CREATE TRIGGER "OrderFulfillment_seller_retention" BEFORE DELETE ON "OrderFulfillment" FOR EACH ROW EXECUTE FUNCTION retain_posted_seller_purchase();
-- Existing purchases have explicit unknown terms from migration 28, so this
-- builds truthful holds without posting invented historic seller earnings.
DO $$ DECLARE target TEXT; BEGIN FOR target IN SELECT DISTINCT "orderId" FROM "OrderFulfillment" ORDER BY "orderId" LOOP PERFORM reconcile_seller_order(target); END LOOP; END $$;
COMMIT;
