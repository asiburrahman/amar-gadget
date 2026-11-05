-- Additive publication storage. No sample articles, legal promises, accounts,
-- old migration changes or existing-data rewrites are part of this migration.
CREATE FUNCTION valid_site_content_address(kind text, slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT char_length(slug) BETWEEN 1 AND 100 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 AND ((kind='PAGE' AND slug IN ('about','faq','returns','privacy-policy','terms')) OR kind='ARTICLE')
$$;

CREATE FUNCTION valid_site_content_document(document jsonb, publishing boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE section jsonb; compact text; separator text := ''; minimum integer;
BEGIN
 IF jsonb_typeof(document) IS DISTINCT FROM 'object'
 OR NOT document ?& ARRAY['title','summary','byline','sections']
 OR document - ARRAY['title','summary','byline','sections'] <> '{}'::jsonb
 OR jsonb_typeof(document->'title') IS DISTINCT FROM 'string'
 OR jsonb_typeof(document->'summary') IS DISTINCT FROM 'string'
 OR jsonb_typeof(document->'byline') IS DISTINCT FROM 'string'
 OR jsonb_typeof(document->'sections') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF char_length(document->>'title') > 160 OR char_length(document->>'summary') > 500
 OR char_length(document->>'byline') > 100 OR jsonb_array_length(document->'sections') > 24
 OR (document->>'title') ~ '[[:cntrl:]]' OR (document->>'summary') ~ '[[:cntrl:]]'
 OR (document->>'byline') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
 IF publishing AND (char_length(btrim(document->>'title')) < 3
 OR char_length(btrim(document->>'summary')) < 10 OR jsonb_array_length(document->'sections')=0) THEN RETURN false; END IF;
 compact := '{"title":'||(document->'title')::text||',"summary":'||(document->'summary')::text
   ||',"byline":'||(document->'byline')::text||',"sections":[';
 FOR section IN SELECT value FROM jsonb_array_elements(document->'sections') LOOP
  IF jsonb_typeof(section) IS DISTINCT FROM 'object' OR NOT section ?& ARRAY['heading','body']
  OR section - ARRAY['heading','body'] <> '{}'::jsonb
  OR jsonb_typeof(section->'heading') IS DISTINCT FROM 'string'
  OR jsonb_typeof(section->'body') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  IF char_length(section->>'heading') > 160 OR char_length(section->>'body') > 8000
  OR (section->>'heading') ~ '[[:cntrl:]]'
  OR translate(section->>'body', E'\n\r\t', '') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  minimum := CASE WHEN publishing THEN 10 ELSE 0 END;
  IF char_length(btrim(section->>'body', E' \n\r\t')) < minimum
  OR (publishing AND char_length(btrim(section->>'heading')) < 2) THEN RETURN false; END IF;
  compact := compact || separator || '{"heading":'||(section->'heading')::text||',"body":'||(section->'body')::text||'}';
  separator := ',';
 END LOOP;
 RETURN octet_length(compact||']}') <= 96000;
END $$;

CREATE TABLE "SiteContent" (
 kind VARCHAR(12) NOT NULL, slug VARCHAR(100) NOT NULL, version INTEGER NOT NULL,
 draft JSONB NOT NULL, "publishedVersion" INTEGER, "publishedAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "SiteContent_pkey" PRIMARY KEY (kind,slug),
 CONSTRAINT "SiteContent_address" CHECK (valid_site_content_address(kind,slug)),
 CONSTRAINT "SiteContent_version" CHECK (version >= 1 AND ("publishedVersion" IS NULL OR "publishedVersion" BETWEEN 1 AND version)),
 CONSTRAINT "SiteContent_document" CHECK (valid_site_content_document(draft)),
 CONSTRAINT "SiteContent_publication_pair" CHECK (("publishedVersion" IS NULL)=("publishedAt" IS NULL))
);
CREATE INDEX "SiteContent_kind_publishedAt_slug_idx" ON "SiteContent"(kind,"publishedAt" DESC,slug);
CREATE INDEX "SiteContent_kind_updatedAt_slug_idx" ON "SiteContent"(kind,"updatedAt" DESC,slug);

CREATE TABLE "SiteContentRevision" (
 kind VARCHAR(12) NOT NULL, slug VARCHAR(100) NOT NULL, version INTEGER NOT NULL,
 "requestId" UUID NOT NULL, "contentHash" VARCHAR(64) NOT NULL, "actorId" TEXT NOT NULL,
 action VARCHAR(16) NOT NULL, reason VARCHAR(500) NOT NULL, reviewed BOOLEAN NOT NULL DEFAULT false,
 before JSONB, after JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "SiteContentRevision_pkey" PRIMARY KEY (kind,slug,version),
 CONSTRAINT "SiteContentRevision_address" CHECK (valid_site_content_address(kind,slug)),
 CONSTRAINT "SiteContentRevision_values" CHECK (version>=1 AND action IN ('DRAFT','PUBLISH','UNPUBLISH')
  AND "contentHash" ~ '^[a-f0-9]{64}$' AND char_length("actorId") BETWEEN 1 AND 64
  AND char_length(btrim(reason)) BETWEEN 5 AND 500 AND reason !~ '[[:cntrl:]]'
  AND (reviewed=(action='PUBLISH'))),
 CONSTRAINT "SiteContentRevision_state" CHECK (jsonb_typeof(after)='object'
  AND after ?& ARRAY['kind','slug','version','draft','publishedVersion']
  AND after - ARRAY['kind','slug','version','draft','publishedVersion']='{}'::jsonb
  AND after->>'kind'=kind AND after->>'slug'=slug AND after->'version'=to_jsonb(version)
  AND valid_site_content_document(after->'draft',action='PUBLISH'))
);
CREATE UNIQUE INDEX "SiteContentRevision_requestId_key" ON "SiteContentRevision"("requestId");
ALTER TABLE "SiteContent" ADD CONSTRAINT "SiteContent_publication_fkey"
 FOREIGN KEY (kind,slug,"publishedVersion") REFERENCES "SiteContentRevision"(kind,slug,version)
 ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION site_content_state(kind text, slug text, version integer, draft jsonb, published integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('kind',kind,'slug',slug,'version',version,'draft',draft,'publishedVersion',published)
$$;

CREATE FUNCTION guard_site_content_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence "SiteContentRevision"%ROWTYPE; expected_before jsonb; issued "SiteContentRevision"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Site content is retained; unpublish it instead' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 THEN RAISE EXCEPTION 'First site content revision must be one' USING ERRCODE='23514'; END IF;
  expected_before := NULL;
 ELSE
  IF NEW.kind<>OLD.kind OR NEW.slug<>OLD.slug OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'A matching next site content revision is required' USING ERRCODE='23514';
  END IF;
  expected_before := site_content_state(OLD.kind,OLD.slug,OLD.version,OLD.draft,OLD."publishedVersion");
 END IF;
 SELECT * INTO evidence FROM "SiteContentRevision" WHERE kind=NEW.kind AND slug=NEW.slug AND version=NEW.version;
 IF NOT FOUND OR evidence.before IS DISTINCT FROM expected_before
 OR evidence.after IS DISTINCT FROM site_content_state(NEW.kind,NEW.slug,NEW.version,NEW.draft,NEW."publishedVersion") THEN
  RAISE EXCEPTION 'Matching site content decision evidence is required' USING ERRCODE='23514';
 END IF;
 IF evidence.action='DRAFT' THEN
  IF (TG_OP='INSERT' AND NEW."publishedVersion" IS NOT NULL)
  OR (TG_OP='UPDATE' AND (NEW."publishedVersion" IS DISTINCT FROM OLD."publishedVersion" OR NEW.draft=OLD.draft)) THEN
   RAISE EXCEPTION 'Draft decisions must change only the private draft' USING ERRCODE='23514';
  END IF;
 ELSIF evidence.action='PUBLISH' THEN
  IF TG_OP='INSERT' OR NEW."publishedVersion" IS DISTINCT FROM NEW.version OR NEW.draft IS DISTINCT FROM OLD.draft THEN
   RAISE EXCEPTION 'Publication requires the saved reviewed draft' USING ERRCODE='23514';
  END IF;
 ELSIF evidence.action='UNPUBLISH' THEN
  IF TG_OP='INSERT' OR OLD."publishedVersion" IS NULL OR NEW."publishedVersion" IS NOT NULL OR NEW.draft IS DISTINCT FROM OLD.draft THEN
   RAISE EXCEPTION 'Unpublication must retain the saved draft' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW."publishedVersion" IS NOT NULL THEN
  SELECT * INTO issued FROM "SiteContentRevision" WHERE kind=NEW.kind AND slug=NEW.slug AND version=NEW."publishedVersion";
  IF NOT FOUND OR issued.action<>'PUBLISH' OR NOT issued.reviewed
  OR issued.after->'publishedVersion' IS DISTINCT FROM to_jsonb(issued.version)
  OR NOT valid_site_content_document(issued.after->'draft',true)
  OR NEW."publishedAt" IS DISTINCT FROM issued."createdAt" THEN
   RAISE EXCEPTION 'Publication must reference a retained reviewed snapshot and timestamp' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW."publishedAt" IS NOT NULL THEN RAISE EXCEPTION 'Unpublished content cannot retain a public timestamp' USING ERRCODE='23514'; END IF;
 END IF;
 NEW."updatedAt" := evidence."createdAt";
 RETURN NEW;
END $$;
CREATE TRIGGER "SiteContent_matching_evidence" BEFORE INSERT OR UPDATE OR DELETE ON "SiteContent"
 FOR EACH ROW EXECUTE FUNCTION guard_site_content_state();

CREATE FUNCTION guard_site_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous "SiteContentRevision"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Site content history is append-only' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "User" WHERE id=NEW."actorId" AND role='ADMIN' AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current verified administrator evidence is required' USING ERRCODE='23514'; END IF;
 NEW."createdAt" := timezone('UTC',clock_timestamp());
 IF NEW.version=1 THEN
  IF NEW.before IS NOT NULL OR NEW.action<>'DRAFT' THEN RAISE EXCEPTION 'Initial site content must be a private draft' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO previous FROM "SiteContentRevision" WHERE kind=NEW.kind AND slug=NEW.slug AND version=NEW.version-1;
  IF NOT FOUND OR NEW.before IS DISTINCT FROM previous.after THEN RAISE EXCEPTION 'Site content revision history must be contiguous' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SiteContentRevision_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "SiteContentRevision"
 FOR EACH ROW EXECUTE FUNCTION guard_site_content_revision();

CREATE FUNCTION verify_site_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_content "SiteContent"%ROWTYPE; next_revision "SiteContentRevision"%ROWTYPE;
BEGIN
 SELECT * INTO current_content FROM "SiteContent" WHERE kind=NEW.kind AND slug=NEW.slug;
 IF NOT FOUND OR current_content.version<NEW.version THEN RAISE EXCEPTION 'Orphan site content history cannot commit' USING ERRCODE='23514'; END IF;
 IF current_content.version=NEW.version THEN
  IF NEW.after IS DISTINCT FROM site_content_state(current_content.kind,current_content.slug,current_content.version,current_content.draft,current_content."publishedVersion") THEN
   RAISE EXCEPTION 'Committed site content must match its history' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO next_revision FROM "SiteContentRevision" WHERE kind=NEW.kind AND slug=NEW.slug AND version=NEW.version+1;
  IF NOT FOUND OR next_revision.before IS DISTINCT FROM NEW.after THEN RAISE EXCEPTION 'Site content history cannot skip a committed state' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "SiteContentRevision_committed_state" AFTER INSERT ON "SiteContentRevision"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_site_content_revision();
