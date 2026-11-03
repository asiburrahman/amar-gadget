BEGIN;
-- No commercial defaults: the operator must explicitly configure real terms.
CREATE TABLE "SellerSettlementPolicy" (
 id TEXT PRIMARY KEY,"scopeKey" VARCHAR(80) NOT NULL,version INTEGER NOT NULL,
 "commissionBps" INTEGER,"shippingRecipient" VARCHAR(16),"createdById" VARCHAR(64) NOT NULL,
 reason VARCHAR(500) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "SellerSettlementPolicy_values" CHECK(version>0 AND length("createdById")>0 AND length(trim(reason))>=5
  AND ("scopeKey"='GLOBAL' OR "scopeKey" ~ '^SELLER:[A-Za-z0-9-]{1,64}$')
  AND (("commissionBps" IS NOT NULL AND "shippingRecipient" IS NOT NULL AND "commissionBps" BETWEEN 0 AND 10000 AND "shippingRecipient" IN ('SELLER','PLATFORM'))
    OR ("scopeKey"<>'GLOBAL' AND "commissionBps" IS NULL AND "shippingRecipient" IS NULL))
  AND (("commissionBps" IS NULL)=("shippingRecipient" IS NULL)))
);
CREATE UNIQUE INDEX "SellerSettlementPolicy_scopeKey_version_key" ON "SellerSettlementPolicy"("scopeKey",version);
CREATE FUNCTION guard_seller_settlement_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous INTEGER;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Commercial policy history is append-only' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."createdById" AND role='ADMIN' AND "isVerified") THEN
  RAISE EXCEPTION 'Commercial policy requires a verified administrator' USING ERRCODE='23514';
 END IF;
 IF NEW."scopeKey"<>'GLOBAL' AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=substring(NEW."scopeKey" FROM 8) AND role IN ('MEMBER','ADMIN')) THEN
  RAISE EXCEPTION 'Commercial policy seller scope does not exist' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('amar.settlement.policy:'||NEW."scopeKey",0));
 SELECT max(version) INTO previous FROM "SellerSettlementPolicy" WHERE "scopeKey"=NEW."scopeKey";
 IF NEW.version<>COALESCE(previous,0)+1 THEN RAISE EXCEPTION 'Commercial policy revision changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SellerSettlementPolicy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SellerSettlementPolicy" FOR EACH ROW EXECUTE FUNCTION guard_seller_settlement_policy();
CREATE TABLE "SellerSettlementSnapshot" (
 "fulfillmentId" VARCHAR(64) PRIMARY KEY,"orderId" VARCHAR(64) NOT NULL,"sellerId" VARCHAR(64) NOT NULL,
 "policyId" TEXT REFERENCES "SellerSettlementPolicy"(id) ON DELETE RESTRICT,
 origin VARCHAR(24) NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 "adoptedById" VARCHAR(64),"adoptionReason" VARCHAR(500),"adoptedAt" TIMESTAMP(3),
 "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "SellerSettlementSnapshot_values" CHECK(version>0 AND origin IN ('CHECKOUT','LEGACY_UNCONFIGURED')
  AND (("adoptedById" IS NULL AND "adoptionReason" IS NULL AND "adoptedAt" IS NULL)
    OR ("policyId" IS NOT NULL AND "adoptedById" IS NOT NULL AND "adoptionReason" IS NOT NULL AND length(trim("adoptionReason"))>=5 AND "adoptedAt" IS NOT NULL)))
);
CREATE INDEX "SellerSettlementSnapshot_sellerId_capturedAt_fulfillmentId_idx" ON "SellerSettlementSnapshot"("sellerId","capturedAt","fulfillmentId");
CREATE INDEX "SellerSettlementSnapshot_orderId_idx" ON "SellerSettlementSnapshot"("orderId");
-- Existing purchases do not inherit a new policy retroactively. An explicit,
-- reasoned administrator adoption is required after reviewing their finances.
INSERT INTO "SellerSettlementSnapshot"("fulfillmentId","orderId","sellerId",origin)
 SELECT id,"orderId","sellerId",'LEGACY_UNCONFIGURED' FROM "OrderFulfillment";
CREATE FUNCTION effective_seller_settlement_policy(seller TEXT) RETURNS TEXT LANGUAGE sql STABLE AS $$
 WITH scoped AS (SELECT * FROM "SellerSettlementPolicy" WHERE "scopeKey"='SELLER:'||seller ORDER BY version DESC LIMIT 1),
 global_policy AS (SELECT * FROM "SellerSettlementPolicy" WHERE "scopeKey"='GLOBAL' ORDER BY version DESC LIMIT 1)
 SELECT id FROM (SELECT id,0 AS priority FROM scoped WHERE "commissionBps" IS NOT NULL
  UNION ALL SELECT id,1 FROM global_policy) candidates ORDER BY priority LIMIT 1;
$$;
CREATE FUNCTION capture_seller_settlement_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "SellerSettlementSnapshot"("fulfillmentId","orderId","sellerId","policyId",origin)
  VALUES(NEW.id,NEW."orderId",NEW."sellerId",effective_seller_settlement_policy(NEW."sellerId"),'CHECKOUT');
 RETURN NULL;
END $$;
CREATE TRIGGER "OrderFulfillment_settlement_policy" AFTER INSERT ON "OrderFulfillment" FOR EACH ROW EXECUTE FUNCTION capture_seller_settlement_policy();
CREATE FUNCTION guard_seller_settlement_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE terms "SellerSettlementPolicy"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Settlement terms evidence is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.version<>1 OR NEW."adoptedById" IS NOT NULL OR NEW."adoptionReason" IS NOT NULL OR NEW."adoptedAt" IS NOT NULL) THEN
  RAISE EXCEPTION 'New commercial snapshots must capture their actual initial revision' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW."fulfillmentId",NEW."orderId",NEW."sellerId",NEW.origin,NEW."capturedAt") IS DISTINCT FROM ROW(OLD."fulfillmentId",OLD."orderId",OLD."sellerId",OLD.origin,OLD."capturedAt")
   OR OLD."policyId" IS NOT NULL OR NEW."policyId" IS NULL OR OLD."adoptedById" IS NOT NULL OR NEW.version<>OLD.version+1
   OR NEW."adoptedById" IS NULL OR length(trim(COALESCE(NEW."adoptionReason",'')))<5 THEN
   RAISE EXCEPTION 'Captured commercial terms cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."adoptedById" AND role='ADMIN' AND "isVerified") THEN
   RAISE EXCEPTION 'Commercial adoption requires a verified administrator' USING ERRCODE='23514';
  END IF;
  NEW."adoptedAt":=timezone('UTC',clock_timestamp());
 END IF;
 IF NEW."policyId" IS NOT NULL THEN
  SELECT * INTO terms FROM "SellerSettlementPolicy" WHERE id=NEW."policyId";
  IF terms.id IS NULL OR terms."commissionBps" IS NULL OR (terms."scopeKey"<>'GLOBAL' AND terms."scopeKey"<>'SELLER:'||NEW."sellerId") THEN
   RAISE EXCEPTION 'Captured terms do not belong to this seller scope' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "OrderFulfillment" WHERE id=NEW."fulfillmentId" AND "orderId"=NEW."orderId" AND "sellerId"=NEW."sellerId") THEN
  RAISE EXCEPTION 'Captured terms require the matching seller shipment' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SellerSettlementSnapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SellerSettlementSnapshot" FOR EACH ROW EXECUTE FUNCTION guard_seller_settlement_snapshot();
COMMIT;
