ALTER TABLE "Product" ADD COLUMN "mediaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD CONSTRAINT "Product_mediaVersion_positive" CHECK ("mediaVersion" > 0);
CREATE TABLE "ProductImageCleanup" (
  key VARCHAR(160) PRIMARY KEY, "ownerId" VARCHAR(64) NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(100) NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImageCleanup_key_owned" CHECK (key ~ ('^products/' || "ownerId" || '/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$')),
  CONSTRAINT "ProductImageCleanup_owner_valid" CHECK ("ownerId" ~ '^[A-Za-z0-9-]{1,64}$'),
  CONSTRAINT "ProductImageCleanup_attempts_valid" CHECK (attempts >= 0)
);
CREATE INDEX "ProductImageCleanup_availableAt_key_idx" ON "ProductImageCleanup"("availableAt", key);
