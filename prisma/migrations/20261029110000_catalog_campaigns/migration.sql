CREATE TABLE "Campaign" (
  id TEXT PRIMARY KEY, title VARCHAR(120) NOT NULL, slug VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '', "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_window_valid" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "Campaign_version_valid" CHECK (version > 0),
  CONSTRAINT "Campaign_title_valid" CHECK (length(btrim(title)) > 0),
  CONSTRAINT "Campaign_slug_valid" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"(slug);
CREATE INDEX "Campaign_isActive_startsAt_endsAt_idx" ON "Campaign"("isActive", "startsAt", "endsAt");
CREATE TABLE "CampaignProduct" (
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 50),
  PRIMARY KEY ("campaignId", "productId")
);
CREATE UNIQUE INDEX "CampaignProduct_campaignId_position_key" ON "CampaignProduct"("campaignId", position);
CREATE INDEX "CampaignProduct_productId_idx" ON "CampaignProduct"("productId");
