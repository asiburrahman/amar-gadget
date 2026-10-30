import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("verified review migration on a fresh isolated database", () => {
  it("quarantines historical feedback, retains duplicate/invalid legacy text and removes unsupported rating aggregates", async () => {
    const name = `audit_reviews_${randomBytes(8).toString("hex")}`;
    if (!/^audit_reviews_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect(); let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), migration = "20261030100000_verified_reviews";
      const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ('old-buyer','old-buyer@example.invalid','USER',now()),('old-seller','old-seller@example.invalid','MEMBER',now()),('old-admin','old-admin@example.invalid','ADMIN',now())`);
      await db.query(`INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ('old-category','Old category','old-category',now())`);
      await db.query(`INSERT INTO "Product" (id,name,slug,price,stock,"sellerId","categoryId",rating,"reviewCount","updatedAt") VALUES ('old-product','Existing gadget','existing-gadget',100,2,'old-seller','old-category',4.8,100,now())`);
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"paymentStatus","updatedAt") VALUES ('old-order','old-buyer',100,'DELIVERED','PAID',now())`);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"updatedAt") VALUES ('old-item','old-order','old-product',1,100,now())`);
      const longComment = "Retained legacy text ".repeat(150);
      await db.query(`INSERT INTO "Review" (id,"userId","productId",rating,comment,"createdAt","updatedAt") VALUES ('older','old-buyer','old-product',9,$1,'2026-10-01','2026-10-01'),('newer','old-buyer','old-product',4,'Newest historical feedback','2026-10-02','2026-10-02')`, [longComment]);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      await db.query(await readFile(join(root, "20261030110000_review_listing_indexes", "migration.sql"), "utf8"));
      const rows = (await db.query(`SELECT id,rating,comment,status,"isCanonical","orderItemId",version FROM "Review" ORDER BY id`)).rows;
      expect(rows).toEqual([{ id: "newer", rating: 4, comment: "Newest historical feedback", status: "LEGACY", isCanonical: true, orderItemId: null, version: 1 }, { id: "older", rating: 9, comment: longComment, status: "LEGACY", isCanonical: false, orderItemId: null, version: 1 }]);
      expect((await db.query(`SELECT rating,"reviewCount","reviewVersion" FROM "Product" WHERE id='old-product'`)).rows[0]).toEqual({ rating: 0, reviewCount: 0, reviewVersion: 0 });
      await expect(db.query(`INSERT INTO "Review" (id,"userId","productId",rating,status,"updatedAt") VALUES ('duplicate','old-buyer','old-product',5,'LEGACY',now())`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "Review" SET status='PENDING',rating=5,"orderItemId"='old-item' WHERE id='older'`)).rejects.toBeDefined();
      await db.query(`UPDATE "Review" SET status='PENDING',rating=5,comment='Owner resubmitted actual purchase',"orderItemId"='old-item',version=2 WHERE id='newer'`);
      await expect(db.query(`UPDATE "Review" SET status='REJECTED',"moderatedAt"=now(),"moderatedById"='old-admin',"moderationReason"=NULL WHERE id='newer'`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "Review" SET rating=0 WHERE id='newer'`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "Review" SET version=0 WHERE id='newer'`)).rejects.toBeDefined();
      await expect(db.query(`DELETE FROM "OrderItem" WHERE id='old-item'`)).rejects.toBeDefined();
      await db.query(`UPDATE "Order" SET "paymentStatus"='UNPAID' WHERE id='old-order'`);
      await expect(db.query(`UPDATE "Review" SET status='PUBLISHED',"moderatedAt"=now(),"moderatedById"='old-admin' WHERE id='newer'`)).rejects.toBeDefined();
      const indexes = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('Review','OrderItem','Product')`)).rows.map((row: { indexname: string }) => row.indexname);
      expect(indexes).toEqual(expect.arrayContaining(["Review_one_canonical_user_product", "Review_userId_createdAt_id_idx", "Review_productId_status_createdAt_id_idx", "Review_orderItemId_idx", "OrderItem_productId_orderId_id_idx", "Product_sellerId_id_idx", "OrderItem_orderId_productId_idx"]));
    } finally { await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); } }
  }, 30_000);
});
