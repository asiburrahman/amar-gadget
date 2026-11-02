BEGIN;
ALTER TABLE "User" ADD COLUMN "administrationVersion" INTEGER NOT NULL DEFAULT 1,
 ADD CONSTRAINT "User_administrationVersion_positive" CHECK("administrationVersion">0);
CREATE INDEX "User_role_createdAt_id_idx" ON "User"(role,"createdAt",id);
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt",id);
CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt",id);
CREATE TABLE "AccountAdminRequest"(id TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,hash TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "AccountAdminRequest_values" CHECK(id ~ '^[a-f0-9-]{36}$' AND length(hash)=64 AND jsonb_typeof(result)='object'));
CREATE TABLE "AccountAdminEvent"(id TEXT PRIMARY KEY,sequence BIGSERIAL NOT NULL UNIQUE,"userId" TEXT NOT NULL,"actorId" TEXT,reason TEXT,"before" JSONB NOT NULL,"after" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
CREATE INDEX "AccountAdminEvent_userId_sequence_idx" ON "AccountAdminEvent"("userId",sequence);
CREATE FUNCTION advance_account_administration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Existing password/OTP/email/session paths also invalidate an open admin draft.
 -- Credential values are compared here but never copied into history.
 IF ROW(NEW.role,NEW."sellerStatus",NEW."isVerified",NEW."sessionVersion",NEW.email,NEW.password)
    IS DISTINCT FROM ROW(OLD.role,OLD."sellerStatus",OLD."isVerified",OLD."sessionVersion",OLD.email,OLD.password) THEN
  NEW."administrationVersion" := OLD."administrationVersion"+1;
 ELSE
  NEW."administrationVersion" := OLD."administrationVersion";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "User_administration_revision" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION advance_account_administration();
CREATE FUNCTION record_account_administration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."administrationVersion"<>OLD."administrationVersion" THEN
  INSERT INTO "AccountAdminEvent"(id,"userId","actorId",reason,"before","after","createdAt") VALUES(gen_random_uuid()::text,NEW.id,NULLIF(current_setting('amar.account_admin_actor_id',true),''),NULLIF(current_setting('amar.account_admin_reason',true),''),
   jsonb_build_object('role',OLD.role,'sellerStatus',OLD."sellerStatus",'isVerified',OLD."isVerified",'sessionVersion',OLD."sessionVersion",'version',OLD."administrationVersion"),
   jsonb_build_object('role',NEW.role,'sellerStatus',NEW."sellerStatus",'isVerified',NEW."isVerified",'sessionVersion',NEW."sessionVersion",'version',NEW."administrationVersion"),timezone('UTC',clock_timestamp()));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "User_administration_history" AFTER UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION record_account_administration();
CREATE FUNCTION guard_account_administration_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Account administration evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "AccountAdminEvent_immutable" BEFORE UPDATE OR DELETE ON "AccountAdminEvent" FOR EACH ROW EXECUTE FUNCTION guard_account_administration_evidence();
CREATE TRIGGER "AccountAdminRequest_immutable" BEFORE UPDATE OR DELETE ON "AccountAdminRequest" FOR EACH ROW EXECUTE FUNCTION guard_account_administration_evidence();
COMMIT;
