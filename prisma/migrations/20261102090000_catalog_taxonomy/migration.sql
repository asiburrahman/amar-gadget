BEGIN;
-- Existing case-fold collisions need operator review; never silently merge
-- category/brand identities or reassign products during this upgrade.
ALTER TABLE "Category" ADD COLUMN version INTEGER NOT NULL DEFAULT 1, ADD COLUMN "parentId" TEXT;
ALTER TABLE "Brand" ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
DROP INDEX "Category_name_key";
CREATE UNIQUE INDEX "Category_sibling_name_key" ON "Category" (COALESCE("parentId",''),lower(btrim(name)));
CREATE UNIQUE INDEX "Category_slug_fold_key" ON "Category" (lower(slug));
CREATE UNIQUE INDEX "Brand_name_fold_key" ON "Brand" (lower(btrim(name)));
CREATE UNIQUE INDEX "Brand_slug_fold_key" ON "Brand" (lower(slug));
CREATE INDEX "Category_parentId_id_idx" ON "Category" ("parentId",id);
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_version_check" CHECK(version>0);
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_version_check" CHECK(version>0);
ALTER TABLE "Product" DROP CONSTRAINT "Product_brandId_fkey";
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "CategoryAlias" (slug TEXT NOT NULL PRIMARY KEY,"categoryId" TEXT NOT NULL REFERENCES "Category"(id) ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "CategoryAlias_categoryId_idx" ON "CategoryAlias"("categoryId");
CREATE UNIQUE INDEX "CategoryAlias_slug_fold_key" ON "CategoryAlias"(lower(slug));
CREATE TABLE "BrandAlias" (slug TEXT NOT NULL PRIMARY KEY,"brandId" TEXT NOT NULL REFERENCES "Brand"(id) ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "BrandAlias_brandId_idx" ON "BrandAlias"("brandId");
CREATE UNIQUE INDEX "BrandAlias_slug_fold_key" ON "BrandAlias"(lower(slug));
CREATE TABLE "TaxonomyRequest" (id TEXT NOT NULL PRIMARY KEY,"ownerId" TEXT NOT NULL,hash TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "TaxonomyRequest_values" CHECK(id ~ '^[a-f0-9-]{36}$' AND length(hash)=64 AND jsonb_typeof(result)='object'));
CREATE TABLE "TaxonomyEvent" (id TEXT NOT NULL PRIMARY KEY,kind TEXT NOT NULL,"targetId" TEXT NOT NULL,action TEXT NOT NULL,"actorId" TEXT,"before" JSONB,"after" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "TaxonomyEvent_kind" CHECK(kind IN ('category','brand') AND action IN ('CREATE','UPDATE','DELETE')));
CREATE INDEX "TaxonomyEvent_kind_targetId_createdAt_id_idx" ON "TaxonomyEvent"(kind,"targetId","createdAt",id);

CREATE FUNCTION guard_catalog_taxonomy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE collision BOOLEAN;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('amar.catalog-taxonomy.v1',0));
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id THEN RAISE EXCEPTION 'Taxonomy identity is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-'updatedAt'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'-'version') AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Current taxonomy revision is required' USING ERRCODE='23514'; END IF;
  IF NEW.version NOT IN (OLD.version,OLD.version+1) THEN RAISE EXCEPTION 'Invalid taxonomy revision' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='Category' THEN
  IF NEW."parentId" IS NOT NULL THEN
   WITH RECURSIVE ancestry AS (SELECT id,"parentId" FROM "Category" WHERE id=NEW."parentId" UNION SELECT c.id,c."parentId" FROM "Category" c JOIN ancestry a ON c.id=a."parentId")
   SELECT EXISTS(SELECT 1 FROM ancestry WHERE id=NEW.id) INTO collision;
   IF collision THEN RAISE EXCEPTION 'Category hierarchy cannot contain a cycle' USING ERRCODE='23514'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM "CategoryAlias" WHERE lower(slug)=lower(NEW.slug) AND "categoryId"<>NEW.id) THEN RAISE EXCEPTION 'Category slug is retained by an earlier URL' USING ERRCODE='23505'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "BrandAlias" WHERE lower(slug)=lower(NEW.slug) AND "brandId"<>NEW.id) THEN RAISE EXCEPTION 'Brand slug is retained by an earlier URL' USING ERRCODE='23505'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Category_guard" BEFORE INSERT OR UPDATE ON "Category" FOR EACH ROW EXECUTE FUNCTION guard_catalog_taxonomy();
CREATE TRIGGER "Brand_guard" BEFORE INSERT OR UPDATE ON "Brand" FOR EACH ROW EXECUTE FUNCTION guard_catalog_taxonomy();

CREATE FUNCTION maintain_catalog_taxonomy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_kind TEXT:=CASE WHEN TG_TABLE_NAME='Category' THEN 'category' ELSE 'brand' END;
BEGIN
 IF TG_OP='UPDATE' AND NEW.slug<>OLD.slug THEN
  IF TG_TABLE_NAME='Category' THEN
   DELETE FROM "CategoryAlias" WHERE "categoryId"=NEW.id AND lower(slug)=lower(NEW.slug);
   INSERT INTO "CategoryAlias"(slug,"categoryId") VALUES(OLD.slug,NEW.id) ON CONFLICT DO NOTHING;
  ELSE
   DELETE FROM "BrandAlias" WHERE "brandId"=NEW.id AND lower(slug)=lower(NEW.slug);
   INSERT INTO "BrandAlias"(slug,"brandId") VALUES(OLD.slug,NEW.id) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 INSERT INTO "TaxonomyEvent"(id,kind,"targetId",action,"actorId","before","after","createdAt")
 VALUES(gen_random_uuid()::text,entity_kind,CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,
  CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'DELETE' THEN 'DELETE' ELSE 'UPDATE' END,
  NULLIF(current_setting('amar.taxonomy_actor_id',true),''),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,timezone('UTC',clock_timestamp()));
 RETURN NULL;
END $$;
CREATE TRIGGER "Category_history" AFTER INSERT OR UPDATE OR DELETE ON "Category" FOR EACH ROW EXECUTE FUNCTION maintain_catalog_taxonomy();
CREATE TRIGGER "Brand_history" AFTER INSERT OR UPDATE OR DELETE ON "Brand" FOR EACH ROW EXECUTE FUNCTION maintain_catalog_taxonomy();

CREATE FUNCTION guard_taxonomy_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('amar.catalog-taxonomy.v1',0));
 IF TG_TABLE_NAME='CategoryAlias' THEN
  IF EXISTS(SELECT 1 FROM "Category" WHERE lower(slug)=lower(NEW.slug) AND id<>NEW."categoryId") THEN RAISE EXCEPTION 'Category alias conflicts with a live URL' USING ERRCODE='23505'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "Brand" WHERE lower(slug)=lower(NEW.slug) AND id<>NEW."brandId") THEN RAISE EXCEPTION 'Brand alias conflicts with a live URL' USING ERRCODE='23505'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CategoryAlias_guard" BEFORE INSERT OR UPDATE ON "CategoryAlias" FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_alias();
CREATE TRIGGER "BrandAlias_guard" BEFORE INSERT OR UPDATE ON "BrandAlias" FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_alias();
CREATE FUNCTION guard_taxonomy_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Taxonomy evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "TaxonomyEvent_immutable" BEFORE UPDATE OR DELETE ON "TaxonomyEvent" FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_evidence();
CREATE TRIGGER "TaxonomyRequest_immutable" BEFORE UPDATE OR DELETE ON "TaxonomyRequest" FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_evidence();
COMMIT;
