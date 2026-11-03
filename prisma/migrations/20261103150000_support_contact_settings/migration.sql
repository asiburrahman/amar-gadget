CREATE TABLE "SupportContactSettings" (
  id TEXT PRIMARY KEY CHECK (id='PUBLIC'),
  email VARCHAR(254), phone VARCHAR(32), address VARCHAR(500), hours VARCHAR(300),
  published BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL CHECK (version>0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  CHECK (NOT published OR coalesce(email,phone,address,hours) IS NOT NULL)
);
CREATE TABLE "SupportContactEvent" (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE CHECK (version>0),
  "actorId" TEXT NOT NULL,
  before JSONB, after JSONB NOT NULL,
  verified BOOLEAN NOT NULL,
  reason VARCHAR(500) NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  CHECK (NOT coalesce((after->>'published')::boolean,false) OR verified)
);
CREATE FUNCTION support_contact_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_settings "SupportContactSettings";
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'support contact history is append only'; END IF;
  SELECT * INTO current_settings FROM "SupportContactSettings" WHERE id='PUBLIC' FOR UPDATE;
  IF NEW.version<>coalesce(current_settings.version,0)+1 OR NEW.before IS DISTINCT FROM (CASE WHEN current_settings.id IS NULL THEN NULL ELSE to_jsonb(current_settings)-'updatedAt' END) THEN
    RAISE EXCEPTION 'support contact history revision mismatch';
  END IF;
  PERFORM id FROM "User" WHERE id=NEW."actorId" AND role='ADMIN' AND "isVerified"=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support contact administrator required'; END IF;
  NEW."createdAt" := timezone('UTC',clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER "SupportContactEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupportContactEvent" FOR EACH ROW EXECUTE FUNCTION support_contact_event_guard();
CREATE FUNCTION support_contact_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'support contact configuration retention required'; END IF;
  IF (TG_OP='INSERT' AND NEW.version<>1) OR (TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.version<>OLD.version+1)) THEN
    RAISE EXCEPTION 'support contact next revision required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "SupportContactEvent" e WHERE e.version=NEW.version AND e.after=to_jsonb(NEW)-'updatedAt') THEN
    RAISE EXCEPTION 'support contact publication evidence required';
  END IF;
  NEW."updatedAt" := timezone('UTC',clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER "SupportContactSettings_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupportContactSettings" FOR EACH ROW EXECUTE FUNCTION support_contact_settings_guard();
CREATE FUNCTION support_contact_committed_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_settings "SupportContactSettings";
BEGIN
  SELECT * INTO current_settings FROM "SupportContactSettings" WHERE id='PUBLIC';
  IF NOT FOUND OR current_settings.version<NEW.version OR (current_settings.version=NEW.version AND to_jsonb(current_settings)-'updatedAt'<>NEW.after) THEN
    RAISE EXCEPTION 'support contact history must commit with its settings';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SupportContactEvent_committed_state" AFTER INSERT ON "SupportContactEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION support_contact_committed_state();
