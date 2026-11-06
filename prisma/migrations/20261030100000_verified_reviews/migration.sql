BEGIN;
ALTER TABLE "Product" ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("reviewVersion">=0);
ALTER TABLE "Review"
  ADD COLUMN "isCanonical" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  ADD COLUMN "orderItemId" TEXT REFERENCES "OrderItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "moderationReason" VARCHAR(300),
  ADD COLUMN "moderatedById" VARCHAR(64),
  ADD COLUMN "moderatedAt" TIMESTAMP(3);
-- Never invent purchase provenance or delete an older customer's text. Keep
-- the newest deterministic row editable; all duplicates stay in owner history.
WITH ranked AS (
 SELECT id,row_number() OVER (PARTITION BY "userId","productId" ORDER BY "createdAt" DESC,id DESC) AS position FROM "Review"
) UPDATE "Review" r SET "isCanonical"=false FROM ranked x WHERE r.id=x.id AND x.position>1;
ALTER TABLE "Review" ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE "Review" ADD CONSTRAINT "Review_state_valid" CHECK (status IN ('LEGACY','PENDING','PUBLISHED','REJECTED','WITHDRAWN'));
ALTER TABLE "Review" ADD CONSTRAINT "Review_content_valid" CHECK (
 status='LEGACY' OR (rating BETWEEN 1 AND 5 AND (comment IS NULL OR char_length(comment)<=2000))
);
ALTER TABLE "Review" ADD CONSTRAINT "Review_provenance_required" CHECK (
 (status='LEGACY' AND "orderItemId" IS NULL) OR (status<>'LEGACY' AND "isCanonical" AND "orderItemId" IS NOT NULL)
);
ALTER TABLE "Review" ADD CONSTRAINT "Review_moderation_valid" CHECK (
 (status IN ('PUBLISHED','REJECTED') AND "moderatedAt" IS NOT NULL AND "moderatedById" IS NOT NULL AND "moderatedById" ~ '^[A-Za-z0-9-]{1,64}$'
   AND (status<>'REJECTED' OR ("moderationReason" IS NOT NULL AND char_length(btrim("moderationReason")) BETWEEN 1 AND 300))) OR
 (status NOT IN ('PUBLISHED','REJECTED') AND "moderatedAt" IS NULL AND "moderatedById" IS NULL AND "moderationReason" IS NULL)
);
CREATE UNIQUE INDEX "Review_one_canonical_user_product" ON "Review"("userId","productId") WHERE "isCanonical";
CREATE INDEX "Review_userId_createdAt_id_idx" ON "Review"("userId","createdAt" DESC,id);
CREATE INDEX "Review_productId_status_createdAt_id_idx" ON "Review"("productId",status,"createdAt" DESC,id);
CREATE INDEX "Review_status_createdAt_id_idx" ON "Review"(status,"createdAt",id);
CREATE INDEX "Review_orderItemId_idx" ON "Review"("orderItemId");
CREATE INDEX "OrderItem_productId_orderId_id_idx" ON "OrderItem"("productId","orderId",id);
CREATE FUNCTION review_purchase_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE purchase_user TEXT; purchase_product TEXT; purchase_status TEXT; purchase_payment TEXT; seller TEXT;
BEGIN
 IF NEW."orderItemId" IS NULL THEN RETURN NEW; END IF;
 SELECT o."userId",i."productId",o.status,o."paymentStatus",p."sellerId"
 INTO purchase_user,purchase_product,purchase_status,purchase_payment,seller
 FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" JOIN "Product" p ON p.id=i."productId"
 WHERE i.id=NEW."orderItemId" FOR SHARE OF o,i;
 IF NOT FOUND OR purchase_user<>NEW."userId" OR purchase_product<>NEW."productId" OR seller=NEW."userId" THEN
   RAISE EXCEPTION 'Review purchase association is invalid' USING ERRCODE='23514';
 END IF;
 IF NEW.status IN ('PENDING','PUBLISHED') AND (purchase_status<>'DELIVERED' OR purchase_payment<>'PAID') THEN
   RAISE EXCEPTION 'Review requires a delivered paid purchase' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Review_purchase_guard" BEFORE INSERT OR UPDATE ON "Review" FOR EACH ROW EXECUTE FUNCTION review_purchase_guard();
-- Historical ratings/counts have no verified publication lineage. Rebuild
-- rather than carrying seeded or unmoderated numbers into the new contract.
UPDATE "Product" SET rating=0,"reviewCount"=0 WHERE rating IS DISTINCT FROM 0 OR "reviewCount" IS DISTINCT FROM 0;
ALTER TABLE "Product" ADD CONSTRAINT "Product_review_aggregate_valid" CHECK (
 "reviewCount">=0 AND rating>=0 AND rating<=5 AND ("reviewCount">0 OR rating=0)
);
COMMIT;
