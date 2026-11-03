CREATE TABLE "SupportMessage" (
  id TEXT PRIMARY KEY,
  "contentHash" VARCHAR(64) NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  name VARCHAR(100) NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  email VARCHAR(254) NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  topic VARCHAR(16) NOT NULL CHECK (topic IN ('ORDER','WARRANTY','SELLER','OTHER')),
  subject VARCHAR(160) NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 160),
  "orderReference" VARCHAR(120) CHECK (char_length("orderReference") BETWEEN 1 AND 120),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 8000),
  "consentAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE INDEX "SupportMessage_status_topic_createdAt_id_idx" ON "SupportMessage"(status,topic,"createdAt",id);
CREATE INDEX "SupportMessage_createdAt_id_idx" ON "SupportMessage"("createdAt",id);
CREATE TABLE "SupportMessageEvent" (
  id TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL REFERENCES "SupportMessage"(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 1),
  "actorId" TEXT NOT NULL,
  "beforeStatus" TEXT NOT NULL CHECK ("beforeStatus" IN ('OPEN','IN_PROGRESS','RESOLVED')),
  "afterStatus" TEXT NOT NULL CHECK ("afterStatus" IN ('OPEN','IN_PROGRESS','RESOLVED')),
  reason VARCHAR(500) NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  UNIQUE("messageId",version),
  CHECK ("beforeStatus" <> "afterStatus")
);
CREATE TABLE "SupportRequest" (
  id TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE FUNCTION support_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'support message retention required'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.version <> 1 THEN RAISE EXCEPTION 'support initial state required'; END IF;
    NEW."createdAt" := timezone('UTC',clock_timestamp());
    NEW."consentAt" := NEW."createdAt";
    NEW."updatedAt" := NEW."createdAt";
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','version','updatedAt']) THEN
    RAISE EXCEPTION 'support original content is immutable';
  END IF;
  IF NEW.status=OLD.status OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'support state revision required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "SupportMessageEvent" e WHERE e."messageId"=OLD.id AND e.version=NEW.version AND e."beforeStatus"=OLD.status AND e."afterStatus"=NEW.status) THEN
    RAISE EXCEPTION 'support status evidence required';
  END IF;
  NEW."updatedAt" := timezone('UTC',clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER "SupportMessage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupportMessage" FOR EACH ROW EXECUTE FUNCTION support_message_guard();
CREATE FUNCTION support_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_message "SupportMessage";
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'support evidence is append only'; END IF;
  SELECT * INTO current_message FROM "SupportMessage" WHERE id=NEW."messageId" FOR UPDATE;
  IF NOT FOUND OR NEW.version<>current_message.version+1 OR NEW."beforeStatus"<>current_message.status THEN RAISE EXCEPTION 'support evidence revision mismatch'; END IF;
  PERFORM id FROM "User" WHERE id=NEW."actorId" AND role='ADMIN' AND "isVerified"=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'support administrator required'; END IF;
  NEW."createdAt" := timezone('UTC',clock_timestamp());
  RETURN NEW;
END $$;
CREATE TRIGGER "SupportMessageEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "SupportMessageEvent" FOR EACH ROW EXECUTE FUNCTION support_event_guard();
CREATE FUNCTION support_event_committed_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_message "SupportMessage";
BEGIN
  SELECT * INTO current_message FROM "SupportMessage" WHERE id=NEW."messageId";
  IF current_message.version<NEW.version OR (current_message.version=NEW.version AND current_message.status<>NEW."afterStatus") THEN
    RAISE EXCEPTION 'support evidence must commit with its state change';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SupportMessageEvent_committed_state" AFTER INSERT ON "SupportMessageEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION support_event_committed_state();
CREATE FUNCTION support_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'support receipts are immutable';
END $$;
CREATE TRIGGER "SupportRequest_guard" BEFORE UPDATE OR DELETE ON "SupportRequest" FOR EACH ROW EXECUTE FUNCTION support_receipt_guard();
