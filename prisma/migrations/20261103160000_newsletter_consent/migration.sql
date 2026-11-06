CREATE TABLE "NewsletterSubscriber" (
  id TEXT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE CHECK (email=lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','UNSUBSCRIBED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation>0),
  "confirmationNonce" TEXT NOT NULL,
  "confirmationExpiresAt" TIMESTAMP(3) NOT NULL,
  "unsubscribeNonce" TEXT NOT NULL,
  "consentVersion" TEXT NOT NULL CHECK (char_length("consentVersion") BETWEEN 1 AND 80),
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3), "unsubscribedAt" TIMESTAMP(3),
  "lastRequestedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  CHECK (status<>'ACTIVE' OR "confirmedAt" IS NOT NULL),
  CHECK (status<>'UNSUBSCRIBED' OR "unsubscribedAt" IS NOT NULL)
);
CREATE INDEX "NewsletterSubscriber_status_createdAt_id_idx" ON "NewsletterSubscriber"(status,"createdAt",id);
CREATE TABLE "NewsletterRequest" (
  id TEXT PRIMARY KEY,
  "contentHash" VARCHAR(64) NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  "subscriberId" TEXT NOT NULL REFERENCES "NewsletterSubscriber"(id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (generation>0),
  state TEXT NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','SENDING','SENT','FAILED','SUPPRESSED','DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  "sentAt" TIMESTAMP(3), "lastErrorCode" TEXT CHECK ("lastErrorCode" IN ('CONFIGURATION','TRANSPORT','REJECTED','REPLACED','ALREADY_ACTIVE','EXPIRED','ATTEMPTS_EXHAUSTED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  CHECK ((state='SENDING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (state<>'SENDING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)),
  CHECK ((state='SENT')=("sentAt" IS NOT NULL))
);
CREATE INDEX "NewsletterRequest_state_nextAttemptAt_createdAt_id_idx" ON "NewsletterRequest"(state,"nextAttemptAt","createdAt",id);
CREATE INDEX "NewsletterRequest_subscriberId_createdAt_idx" ON "NewsletterRequest"("subscriberId","createdAt");
CREATE TABLE "NewsletterEvent" (
  id TEXT PRIMARY KEY,
  "subscriberId" TEXT NOT NULL REFERENCES "NewsletterSubscriber"(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version>0), generation INTEGER NOT NULL CHECK (generation>0),
  kind TEXT NOT NULL CHECK (kind IN ('REQUESTED','RENEWED','CONFIRMED','UNSUBSCRIBED')),
  "beforeStatus" TEXT CHECK ("beforeStatus" IN ('PENDING','ACTIVE','UNSUBSCRIBED')),
  "afterStatus" TEXT NOT NULL CHECK ("afterStatus" IN ('PENDING','ACTIVE','UNSUBSCRIBED')),
  "sourceRequestId" TEXT,
  "consentVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  UNIQUE("subscriberId",version)
);
CREATE FUNCTION newsletter_subscriber_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'newsletter consent retention required'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.generation<>1 THEN RAISE EXCEPTION 'newsletter initial pending consent required'; END IF;
    NEW."createdAt" := timezone('UTC',clock_timestamp());
  ELSE
    IF NEW.id<>OLD.id OR NEW.email<>OLD.email OR NEW."unsubscribeNonce"<>OLD."unsubscribeNonce" OR NEW."createdAt"<>OLD."createdAt" THEN RAISE EXCEPTION 'newsletter identity is immutable'; END IF;
    IF (to_jsonb(NEW)-ARRAY['lastRequestedAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['lastRequestedAt','updatedAt']) THEN
      IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'newsletter next revision required'; END IF;
      IF NOT EXISTS (SELECT 1 FROM "NewsletterEvent" e WHERE e."subscriberId"=OLD.id AND e.version=NEW.version AND e."beforeStatus"=OLD.status AND e."afterStatus"=NEW.status AND e.generation=NEW.generation AND e."consentVersion"=NEW."consentVersion") THEN RAISE EXCEPTION 'newsletter transition evidence required'; END IF;
      IF NEW.status='PENDING' THEN
        IF OLD.status='ACTIVE' OR NEW.generation<>OLD.generation+1 OR NEW."confirmationNonce"=OLD."confirmationNonce" THEN RAISE EXCEPTION 'newsletter renewed confirmation required'; END IF;
      ELSIF NEW.status='ACTIVE' THEN
        IF OLD.status<>'PENDING' OR NEW.generation<>OLD.generation OR NEW."confirmationNonce"<>OLD."confirmationNonce" THEN RAISE EXCEPTION 'newsletter pending confirmation required'; END IF;
      ELSIF NEW.status='UNSUBSCRIBED' THEN
        IF OLD.status='UNSUBSCRIBED' OR NEW.generation<>OLD.generation OR NEW."confirmationNonce"<>OLD."confirmationNonce" THEN RAISE EXCEPTION 'newsletter unsubscribe transition required'; END IF;
      END IF;
    END IF;
    IF NEW."lastRequestedAt" IS DISTINCT FROM OLD."lastRequestedAt" THEN NEW."lastRequestedAt" := timezone('UTC',clock_timestamp()); END IF;
  END IF;
  NEW."updatedAt" := timezone('UTC',clock_timestamp()); RETURN NEW;
END $$;
CREATE TRIGGER "NewsletterSubscriber_guard" BEFORE INSERT OR UPDATE OR DELETE ON "NewsletterSubscriber" FOR EACH ROW EXECUTE FUNCTION newsletter_subscriber_guard();
CREATE FUNCTION newsletter_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subscriber "NewsletterSubscriber";
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'newsletter evidence is append only'; END IF;
  SELECT * INTO subscriber FROM "NewsletterSubscriber" WHERE id=NEW."subscriberId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'newsletter subscriber required'; END IF;
  IF NEW.kind='REQUESTED' THEN
    IF subscriber.version<>1 OR NEW.version<>1 OR NEW.generation<>1 OR NEW."beforeStatus" IS NOT NULL OR NEW."afterStatus"<>'PENDING' OR NEW."sourceRequestId" IS NULL THEN RAISE EXCEPTION 'newsletter initial evidence required'; END IF;
  ELSE
    IF NEW.version<>subscriber.version+1 OR NEW."beforeStatus" IS DISTINCT FROM subscriber.status OR (NEW.kind<>'RENEWED' AND NEW."consentVersion"<>subscriber."consentVersion") THEN RAISE EXCEPTION 'newsletter evidence revision mismatch'; END IF;
    IF NEW.kind='RENEWED' THEN
      IF NEW."afterStatus"<>'PENDING' OR NEW.generation<>subscriber.generation+1 OR subscriber.status='ACTIVE' OR NEW."sourceRequestId" IS NULL THEN RAISE EXCEPTION 'newsletter renewal evidence required'; END IF;
    ELSIF NEW.kind='CONFIRMED' THEN
      IF subscriber.status<>'PENDING' OR NEW."afterStatus"<>'ACTIVE' OR NEW.generation<>subscriber.generation THEN RAISE EXCEPTION 'newsletter confirmation evidence required'; END IF;
    ELSIF NEW.kind='UNSUBSCRIBED' THEN
      IF subscriber.status='UNSUBSCRIBED' OR NEW."afterStatus"<>'UNSUBSCRIBED' OR NEW.generation<>subscriber.generation THEN RAISE EXCEPTION 'newsletter withdrawal evidence required'; END IF;
    END IF;
  END IF;
  NEW."createdAt" := timezone('UTC',clock_timestamp()); RETURN NEW;
END $$;
CREATE TRIGGER "NewsletterEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "NewsletterEvent" FOR EACH ROW EXECUTE FUNCTION newsletter_event_guard();
CREATE FUNCTION newsletter_committed_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subscriber "NewsletterSubscriber";
BEGIN
  IF TG_TABLE_NAME='NewsletterSubscriber' THEN
    IF NOT EXISTS (SELECT 1 FROM "NewsletterEvent" e WHERE e."subscriberId"=NEW.id AND e.version=NEW.version AND e.generation=NEW.generation AND e."afterStatus"=NEW.status AND e."consentVersion"=NEW."consentVersion") THEN RAISE EXCEPTION 'newsletter state requires committed evidence'; END IF;
  ELSE
    SELECT * INTO subscriber FROM "NewsletterSubscriber" WHERE id=NEW."subscriberId";
    IF subscriber.version<NEW.version OR (subscriber.version=NEW.version AND (subscriber.status<>NEW."afterStatus" OR subscriber.generation<>NEW.generation)) THEN RAISE EXCEPTION 'newsletter evidence requires committed state'; END IF;
    IF NEW."sourceRequestId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "NewsletterRequest" r WHERE r.id=NEW."sourceRequestId" AND r."subscriberId"=NEW."subscriberId" AND r.generation=NEW.generation) THEN RAISE EXCEPTION 'newsletter consent request evidence required'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "NewsletterSubscriber_committed" AFTER INSERT OR UPDATE ON "NewsletterSubscriber" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION newsletter_committed_state();
CREATE CONSTRAINT TRIGGER "NewsletterEvent_committed" AFTER INSERT ON "NewsletterEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION newsletter_committed_state();
CREATE FUNCTION newsletter_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subscriber "NewsletterSubscriber";
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'newsletter delivery retention required'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO subscriber FROM "NewsletterSubscriber" WHERE id=NEW."subscriberId" FOR SHARE;
    IF NOT FOUND OR NEW.generation<>subscriber.generation OR NEW.attempts<>0 OR NEW.state NOT IN ('READY','SUPPRESSED') OR NEW."sentAt" IS NOT NULL OR NEW."leaseToken" IS NOT NULL OR NEW."leaseUntil" IS NOT NULL THEN RAISE EXCEPTION 'newsletter initial delivery state required'; END IF;
    IF (NEW.state='READY' AND subscriber.status NOT IN ('PENDING','ACTIVE')) OR (NEW.state='SUPPRESSED' AND subscriber.status<>'ACTIVE') THEN RAISE EXCEPTION 'newsletter delivery must match consent state'; END IF;
    NEW."createdAt" := timezone('UTC',clock_timestamp());
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."contentHash"<>OLD."contentHash" OR NEW."subscriberId"<>OLD."subscriberId" OR NEW.generation<>OLD.generation OR NEW."createdAt"<>OLD."createdAt" OR NEW.attempts<OLD.attempts) THEN RAISE EXCEPTION 'newsletter delivery identity is immutable'; END IF;
  IF TG_OP='UPDATE' AND OLD.state IN ('SENT','SUPPRESSED') AND (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt') THEN RAISE EXCEPTION 'newsletter final delivery outcome is retained'; END IF;
  IF TG_OP='UPDATE' AND NEW.state='SENDING' AND (OLD.state<>'SENDING' OR NEW."leaseToken" IS DISTINCT FROM OLD."leaseToken") AND NEW.attempts<>OLD.attempts+1 THEN RAISE EXCEPTION 'newsletter delivery claim counter required'; END IF;
  IF TG_OP='UPDATE' AND NEW.state='SENT' AND OLD.state<>'SENT' THEN
    IF OLD.state<>'SENDING' OR OLD."leaseUntil"<=timezone('UTC',clock_timestamp()) THEN RAISE EXCEPTION 'newsletter active delivery lease required'; END IF;
    NEW."sentAt" := timezone('UTC',clock_timestamp());
  END IF;
  NEW."updatedAt" := timezone('UTC',clock_timestamp()); RETURN NEW;
END $$;
CREATE TRIGGER "NewsletterRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "NewsletterRequest" FOR EACH ROW EXECUTE FUNCTION newsletter_request_guard();
