import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
const migration = "20261102130000_seller_catalog_maintenance";
async function fixtureDatabase() {
  const name = `audit_product_maintenance_migration_${randomBytes(8).toString("hex")}`;
  if (!/^audit_product_maintenance_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid owned database name");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); let db: Client | undefined, created = false;
  const close = async () => { try { await db?.end(); if (created) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
    const root = join(process.cwd(), "prisma/migrations"), names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    return { db, sql: await readFile(join(root, migration, "migration.sql"), "utf8"), close };
  } catch (error) { await close(); throw error; }
}
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("seller catalog migration on a fresh legacy fixture", () => {
  it("preserves prior purchase labels with provenance, captures new purchases and separates stock/catalog revisions", async () => {
    const fixture = await fixtureDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "User"(id,email,"updatedAt") VALUES ('seller','maintenance-migration@example.invalid',now()); INSERT INTO "Category"(id,name,slug,"updatedAt") VALUES ('category','Migration category','migration-category',now()); INSERT INTO "Product"(id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('product','Original product','original-product',100,5,'seller','category',now()); INSERT INTO "Order"(id,"userId",total,"updatedAt") VALUES ('old-order','seller',100,now()); INSERT INTO "OrderItem"(id,"orderId","productId",quantity,price,"updatedAt") VALUES ('old-line','old-order','product',1,100,now())`);
      await db.query(fixture.sql);
      expect((await db.query(`SELECT "productName","productSlug","productSnapshotSource",price FROM "OrderItem" WHERE id='old-line'`)).rows[0]).toEqual({ productName: "Original product", productSlug: "original-product", productSnapshotSource: "LEGACY_CURRENT", price: "100.00" });
      await db.query(`SET TIMEZONE='Asia/Dhaka'; UPDATE "Product" SET stock=stock-1 WHERE id='product'`);
      expect((await db.query(`SELECT "catalogVersion","inventoryVersion",stock FROM "Product" WHERE id='product'`)).rows[0]).toEqual({ catalogVersion: 1, inventoryVersion: 2, stock: 4 });
      await db.query(`SELECT set_config('amar.product_maintenance_actor_id','seller',false),set_config('amar.product_maintenance_reason','Actual reviewed name change',false)`);
      await db.query(`UPDATE "Product" SET name='Edited product',price=120 WHERE id='product'`);
      expect((await db.query(`SELECT "catalogVersion","inventoryVersion" FROM "Product" WHERE id='product'`)).rows[0]).toEqual({ catalogVersion: 2, inventoryVersion: 2 });
      expect((await db.query(`SELECT "productName",price FROM "OrderItem" WHERE id='old-line'`)).rows[0]).toEqual({ productName: "Original product", price: "100.00" });
      await db.query(`INSERT INTO "Order"(id,"userId",total,"updatedAt") VALUES ('new-order','seller',120,now()); INSERT INTO "OrderItem"(id,"orderId","productId",quantity,price,"updatedAt","productName","productSlug","productSnapshotSource") VALUES ('new-line','new-order','product',1,120,now(),'Forged label','forged-link','LEGACY_CURRENT')`);
      expect((await db.query(`SELECT "productName","productSlug","productSnapshotSource" FROM "OrderItem" WHERE id='new-line'`)).rows[0]).toEqual({ productName: "Edited product", productSlug: "original-product", productSnapshotSource: "PURCHASE" });
      await expect(db.query(`UPDATE "OrderItem" SET "productName"='Replacement receipt label' WHERE id='old-line'`)).rejects.toMatchObject({ code: "23514" });
      const events = (await db.query(`SELECT "ownerId","actorId",reason,"before","after",EXTRACT(EPOCH FROM ("createdAt" AT TIME ZONE 'UTC'))::float8 AS instant FROM "ProductMaintenanceEvent" ORDER BY sequence`)).rows;
      expect(events).toHaveLength(2); expect(events[1]).toMatchObject({ ownerId: "seller", actorId: "seller", reason: "Actual reviewed name change", before: { name: "Original product" }, after: { name: "Edited product" } }); expect(Math.abs(events[1].instant * 1000 - Date.now())).toBeLessThan(10000);
      await expect(db.query(`DELETE FROM "ProductMaintenanceEvent"`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`INSERT INTO "ProductMaintenanceRequest"(id,"ownerId",hash,result) VALUES ($1,'seller',$2,'{"id":"product","version":2}')`, [randomUUID(), "a".repeat(64)]);
      await expect(db.query(`UPDATE "ProductMaintenanceRequest" SET result='{}'`)).rejects.toMatchObject({ code: "23514" });
      // PostgreSQL versions can report an ON DELETE RESTRICT foreign key as
      // restrict_violation or foreign_key_violation. Both must identify the
      // purchase relationship, and neither may remove the product or receipts.
      await expect(db.query(`DELETE FROM "Product" WHERE id='product'`)).rejects.toMatchObject({
        code: expect.stringMatching(/^(23001|23503)$/), constraint: "OrderItem_productId_fkey",
      });
      expect((await db.query(`SELECT name,stock FROM "Product" WHERE id='product'`)).rows[0]).toEqual({ name: "Edited product", stock: 4 });
      expect((await db.query(`SELECT count(*)::integer AS count FROM "OrderItem" WHERE "productId"='product'`)).rows[0].count).toBe(2);
      expect((await db.query(`SELECT id,"productName" FROM "OrderItem" WHERE "productId"='product' ORDER BY id`)).rows).toEqual([
        { id: "new-line", productName: "Edited product" }, { id: "old-line", productName: "Original product" },
      ]);
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
});
