BEGIN;
CREATE TABLE "UserAvatarLegacy" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 value TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "User" ADD COLUMN "avatarKey" VARCHAR(160), ADD COLUMN "avatarVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("avatarVersion">=0);
-- Keep historical photos privately rather than serving an unverified URL or
-- inline blob as a new trusted reference. The owner can explicitly restore a
-- supported raster through the same decode/storage pipeline or discard it.
INSERT INTO "UserAvatarLegacy" ("userId",value) SELECT id,avatar FROM "User" WHERE avatar IS NOT NULL AND length(avatar)>0;
UPDATE "User" SET avatar=NULL WHERE avatar IS NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_avatar_owned_reference" CHECK (
 (avatar IS NULL AND "avatarKey" IS NULL) OR
 (avatar IS NOT NULL AND "avatarKey" IS NOT NULL AND
  "avatarKey" ~ '^avatars/[A-Za-z0-9-]{1,64}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$' AND
  split_part("avatarKey",'/',2)=id AND avatar ~ '^https://[^/?#@[:space:]]+/avatars/' AND
  right(avatar,length("avatarKey")+1)='/'||"avatarKey" AND avatar !~ '[?#[:cntrl:]]' AND strpos(avatar,chr(92))=0)
);
CREATE TABLE "AvatarImageCleanup" (
 key VARCHAR(160) PRIMARY KEY, "ownerId" VARCHAR(64) NOT NULL,
 "availableAt" TIMESTAMP(3) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
 "lastError" VARCHAR(100), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AvatarImageCleanup_owner_key" CHECK (
  "ownerId" ~ '^[A-Za-z0-9-]{1,64}$' AND
  key ~ '^avatars/[A-Za-z0-9-]{1,64}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$' AND split_part(key,'/',2)="ownerId")
);
CREATE INDEX "AvatarImageCleanup_availableAt_key_idx" ON "AvatarImageCleanup"("availableAt",key);
COMMIT;
