import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("wishlist migration rehearsal on a fresh isolated database", () => {
  it("preserves saved membership, adds revision zero and keeps unique membership with an ordered read index", async () => {
    const name = `audit_wishlist_${randomBytes(8).toString("hex")}`;
    if (!/^audit_wishlist_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), migration = "20261029140000_wishlist_sync";
      const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('old-owner','old-owner@example.invalid',now())`);
      await db.query(`INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ('old-category','Old category','old-category',now())`);
      await db.query(`INSERT INTO "Product" (id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('old-product','Existing gadget','existing-gadget',100,2,'old-owner','old-category',now())`);
      await db.query(`INSERT INTO "Wishlist" (id,"userId","productId") VALUES ('old-wish','old-owner','old-product')`);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT id,"userId","productId" FROM "Wishlist"`)).rows).toEqual([{ id: "old-wish", userId: "old-owner", productId: "old-product" }]);
      expect((await db.query(`SELECT "wishlistVersion" FROM "User" WHERE id='old-owner'`)).rows[0].wishlistVersion).toBe(0);
      await expect(db.query(`UPDATE "User" SET "wishlistVersion"=-1 WHERE id='old-owner'`)).rejects.toBeDefined();
      await expect(db.query(`INSERT INTO "Wishlist" (id,"userId","productId") VALUES ('duplicate','old-owner','old-product')`)).rejects.toBeDefined();
      expect((await db.query(`SELECT indexname FROM pg_indexes WHERE tablename='Wishlist' AND indexname='Wishlist_userId_createdAt_id_idx'`)).rows).toHaveLength(1);
    } finally { await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); } }
  }, 30_000);
});
