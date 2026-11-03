BEGIN;
ALTER TABLE "Product" ADD COLUMN "catalogVersion" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "inventoryVersion" INTEGER NOT NULL DEFAULT 1,
 ADD CONSTRAINT "Product_maintenance_versions" CHECK("catalogVersion">0 AND "inventoryVersion">0);
CREATE INDEX "Product_sellerId_status_createdAt_id_idx" ON "Product"("sellerId",status,"createdAt",id);
ALTER TABLE "OrderItem" ADD COLUMN "productName" TEXT, ADD COLUMN "productSlug" TEXT, ADD COLUMN "productSnapshotSource" TEXT;
-- Preserve the label currently shown for legacy purchases, with explicit
-- provenance; do not claim that unavailable original purchase text was recovered.
UPDATE "OrderItem" i SET "productName"=p.name,"productSlug"=p.slug,"productSnapshotSource"='LEGACY_CURRENT' FROM "Product" p WHERE p.id=i."productId";
CREATE FUNCTION capture_order_product_label() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT name,slug INTO NEW."productName",NEW."productSlug" FROM "Product" WHERE id=NEW."productId";
  NEW."productSnapshotSource" := 'PURCHASE';
 ELSE
  IF ROW(NEW."productName",NEW."productSlug",NEW."productSnapshotSource") IS DISTINCT FROM ROW(OLD."productName",OLD."productSlug",OLD."productSnapshotSource") THEN
   RAISE EXCEPTION 'Purchase product labels are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderItem_purchase_label" BEFORE INSERT OR UPDATE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION capture_order_product_label();
CREATE TABLE "ProductMaintenanceRequest"(id TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,hash TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
 CONSTRAINT "ProductMaintenanceRequest_values" CHECK(id ~ '^[a-f0-9-]{36}$' AND length(hash)=64 AND jsonb_typeof(result)='object'));
CREATE TABLE "ProductMaintenanceEvent"(id TEXT PRIMARY KEY,sequence BIGSERIAL NOT NULL UNIQUE,"productId" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"actorId" TEXT,reason TEXT,"before" JSONB NOT NULL,"after" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP));
CREATE INDEX "ProductMaintenanceEvent_productId_sequence_idx" ON "ProductMaintenanceEvent"("productId",sequence);
CREATE FUNCTION advance_product_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.name,NEW.slug,NEW.description,NEW.specifications,NEW.price,NEW."discountPrice",NEW."imageUrl",NEW.images,NEW."isFeatured",NEW.status,NEW."sellerId",NEW."categoryId",NEW."brandId")
    IS DISTINCT FROM ROW(OLD.name,OLD.slug,OLD.description,OLD.specifications,OLD.price,OLD."discountPrice",OLD."imageUrl",OLD.images,OLD."isFeatured",OLD.status,OLD."sellerId",OLD."categoryId",OLD."brandId") THEN
  NEW."catalogVersion" := OLD."catalogVersion"+1;
 ELSE NEW."catalogVersion" := OLD."catalogVersion";
 END IF;
 IF NEW.stock IS DISTINCT FROM OLD.stock THEN NEW."inventoryVersion" := OLD."inventoryVersion"+1;
 ELSE NEW."inventoryVersion" := OLD."inventoryVersion";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Product_maintenance_revision" BEFORE UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION advance_product_maintenance();
CREATE FUNCTION record_product_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."catalogVersion"<>OLD."catalogVersion" OR NEW."inventoryVersion"<>OLD."inventoryVersion" THEN
  INSERT INTO "ProductMaintenanceEvent"(id,"productId","ownerId","actorId",reason,"before","after","createdAt") VALUES(gen_random_uuid()::text,NEW.id,NEW."sellerId",NULLIF(current_setting('amar.product_maintenance_actor_id',true),''),NULLIF(current_setting('amar.product_maintenance_reason',true),''),
   jsonb_build_object('name',OLD.name,'price',OLD.price,'discountPrice',OLD."discountPrice",'stock',OLD.stock,'status',OLD.status,'catalogVersion',OLD."catalogVersion",'inventoryVersion',OLD."inventoryVersion",'mediaVersion',OLD."mediaVersion"),
   jsonb_build_object('name',NEW.name,'price',NEW.price,'discountPrice',NEW."discountPrice",'stock',NEW.stock,'status',NEW.status,'catalogVersion',NEW."catalogVersion",'inventoryVersion',NEW."inventoryVersion",'mediaVersion',NEW."mediaVersion"),timezone('UTC',clock_timestamp()));
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "Product_maintenance_history" AFTER UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION record_product_maintenance();
CREATE FUNCTION guard_product_maintenance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Product maintenance evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "ProductMaintenanceEvent_immutable" BEFORE UPDATE OR DELETE ON "ProductMaintenanceEvent" FOR EACH ROW EXECUTE FUNCTION guard_product_maintenance_evidence();
CREATE TRIGGER "ProductMaintenanceRequest_immutable" BEFORE UPDATE OR DELETE ON "ProductMaintenanceRequest" FOR EACH ROW EXECUTE FUNCTION guard_product_maintenance_evidence();
COMMIT;
