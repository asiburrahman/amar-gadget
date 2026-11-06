ALTER TABLE "User" ADD COLUMN "wishlistVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_wishlistVersion_nonnegative" CHECK ("wishlistVersion" >= 0);
CREATE INDEX "Wishlist_userId_createdAt_id_idx" ON "Wishlist"("userId", "createdAt", id);
