BEGIN;
ALTER TABLE "Banner" ADD COLUMN placement TEXT NOT NULL DEFAULT 'HERO',
 ADD COLUMN position INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "Banner" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC',CURRENT_TIMESTAMP);
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_values" CHECK (
 placement IN ('HERO','PROMO','AD') AND position BETWEEN 0 AND 1000000 AND version>0
 AND char_length(btrim(title)) BETWEEN 1 AND 160 AND (subtitle IS NULL OR char_length(subtitle)<=500)
);
CREATE INDEX "Banner_placement_isActive_position_id_idx" ON "Banner"(placement,"isActive",position,id);
CREATE TABLE "BannerRequest"(id TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,hash TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "BannerRequest_values" CHECK(id ~ '^[a-f0-9-]{36}$' AND length(hash)=64 AND jsonb_typeof(result)='object'));
CREATE TABLE "BannerEvent"(id TEXT PRIMARY KEY,sequence BIGSERIAL NOT NULL UNIQUE,"bannerId" TEXT NOT NULL,action TEXT NOT NULL,"actorId" TEXT,"before" JSONB,"after" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "BannerEvent_action" CHECK(action IN ('CREATE','UPDATE','DELETE')));
CREATE INDEX "BannerEvent_bannerId_sequence_idx" ON "BannerEvent"("bannerId",sequence);
CREATE FUNCTION guard_banner_administration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id THEN RAISE EXCEPTION 'Banner identity is immutable' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'updatedAt'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'-'version') AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Current banner revision is required' USING ERRCODE='23514'; END IF;
 IF NEW.version NOT IN (OLD.version,OLD.version+1) THEN RAISE EXCEPTION 'Invalid banner revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Banner_administration_guard" BEFORE UPDATE ON "Banner" FOR EACH ROW EXECUTE FUNCTION guard_banner_administration();
CREATE FUNCTION record_banner_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "BannerEvent"(id,"bannerId",action,"actorId","before","after","createdAt") VALUES(gen_random_uuid()::text,
 CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END,
 NULLIF(current_setting('amar.banner_actor_id',true),''),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,timezone('UTC',clock_timestamp()));
 RETURN NULL;
END $$;
CREATE TRIGGER "Banner_history" AFTER INSERT OR UPDATE OR DELETE ON "Banner" FOR EACH ROW EXECUTE FUNCTION record_banner_event();
CREATE FUNCTION guard_banner_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Banner evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "BannerEvent_immutable" BEFORE UPDATE OR DELETE ON "BannerEvent" FOR EACH ROW EXECUTE FUNCTION guard_banner_evidence();
CREATE TRIGGER "BannerRequest_immutable" BEFORE UPDATE OR DELETE ON "BannerRequest" FOR EACH ROW EXECUTE FUNCTION guard_banner_evidence();
COMMIT;
