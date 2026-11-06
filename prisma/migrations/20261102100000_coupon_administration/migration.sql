BEGIN;
-- Legacy invalid/noncanonical rules require operator review. Do not silently
-- clamp discounts, merge codes or rewrite earlier purchase snapshots.
ALTER TABLE "Coupon" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "Coupon" ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_rule_values" CHECK (
 version>0 AND char_length(code) BETWEEN 1 AND 64 AND code=upper(btrim(code)) AND code !~ '[[:cntrl:]]'
 AND discount>0 AND (NOT "isPercentage" OR discount<=100) AND ("minSpend" IS NULL OR "minSpend">=0)
);
CREATE INDEX "Order_coupon_lookup_idx" ON "Order" (upper(btrim("couponCode"))) WHERE "couponCode" IS NOT NULL;
CREATE TABLE "CouponRequest"(id TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,hash TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "CouponRequest_values" CHECK(id ~ '^[a-f0-9-]{36}$' AND length(hash)=64 AND jsonb_typeof(result)='object'));
CREATE TABLE "CouponEvent"(id TEXT PRIMARY KEY,sequence BIGSERIAL NOT NULL UNIQUE,"couponId" TEXT NOT NULL,action TEXT NOT NULL,"actorId" TEXT,"before" JSONB,"after" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "CouponEvent_action" CHECK(action IN ('CREATE','UPDATE','DELETE')));
CREATE INDEX "CouponEvent_couponId_sequence_idx" ON "CouponEvent"("couponId",sequence);
CREATE FUNCTION guard_coupon_administration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id THEN RAISE EXCEPTION 'Coupon identity is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-'updatedAt'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'-'version') AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Current coupon revision is required' USING ERRCODE='23514'; END IF;
  IF NEW.version NOT IN (OLD.version,OLD.version+1) THEN RAISE EXCEPTION 'Invalid coupon revision' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND NEW.code<>OLD.code) THEN
  IF EXISTS(SELECT 1 FROM "Order" WHERE "couponCode" IS NOT NULL AND upper(btrim("couponCode"))=OLD.code) THEN RAISE EXCEPTION 'Purchased coupon codes are retained; edit rules or deactivate' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Coupon_administration_guard" BEFORE UPDATE OR DELETE ON "Coupon" FOR EACH ROW EXECUTE FUNCTION guard_coupon_administration();
CREATE FUNCTION record_coupon_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "CouponEvent"(id,"couponId",action,"actorId","before","after","createdAt") VALUES(gen_random_uuid()::text,
 CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END,
 NULLIF(current_setting('amar.coupon_actor_id',true),''),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,timezone('UTC',clock_timestamp()));
 RETURN NULL;
END $$;
CREATE TRIGGER "Coupon_history" AFTER INSERT OR UPDATE OR DELETE ON "Coupon" FOR EACH ROW EXECUTE FUNCTION record_coupon_event();
CREATE FUNCTION guard_coupon_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Coupon evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "CouponEvent_immutable" BEFORE UPDATE OR DELETE ON "CouponEvent" FOR EACH ROW EXECUTE FUNCTION guard_coupon_evidence();
CREATE TRIGGER "CouponRequest_immutable" BEFORE UPDATE OR DELETE ON "CouponRequest" FOR EACH ROW EXECUTE FUNCTION guard_coupon_evidence();
CREATE FUNCTION retain_order_coupon_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."couponCode" IS DISTINCT FROM OLD."couponCode" THEN RAISE EXCEPTION 'Purchase coupon snapshot is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Order_coupon_snapshot_guard" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION retain_order_coupon_snapshot();
COMMIT;
