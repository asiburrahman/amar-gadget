import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("seller shipment migration on a fresh local database", () => {
  it("preserves legacy shipment facts, binds immutable seller/item assignments and enforces aggregate state/history", async () => {
    const name = `audit_fulfillment_migration_${randomBytes(8).toString("hex")}`;
    if (!/^audit_fulfillment_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid database fixture name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), migration = "20261030130000_vendor_fulfillments";
      const names = (await readdir(root, { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).sort(); expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,role,"isVerified","updatedAt") VALUES ('vendor-a','a@example.invalid','MEMBER',true,now()),('vendor-b','b@example.invalid','MEMBER',true,now()),('buyer','buyer@example.invalid','USER',true,now())`);
      await db.query(`INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ('category','Category','category',now())`);
      await db.query(`INSERT INTO "Product" (id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('p-a','Product A','product-a',10,4,'vendor-a','category',now()),('p-b','Product B','product-b',20,4,'vendor-b','category',now())`);
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"paymentMethod","paymentStatus","shippingCarrier","shipmentTrackingNumber","createdAt","updatedAt") VALUES ('legacy','buyer',30,'SHIPPED','COD','UNPAID','Recorded courier','OLD-TRACK','2026-01-01',now())`);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"updatedAt") VALUES ('i-a','legacy','p-a',1,10,now()),('i-b','legacy','p-b',1,20,now())`);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      const legacy = (await db.query(`SELECT "sellerId",status,carrier,"trackingNumber","shippedAt","deliveredAt","legacySnapshot",version FROM "OrderFulfillment" WHERE "orderId"='legacy' ORDER BY "sellerId"`)).rows;
      expect(legacy).toEqual(["vendor-a", "vendor-b"].map((sellerId) => ({ sellerId, status: "SHIPPED", carrier: "Recorded courier", trackingNumber: "OLD-TRACK", shippedAt: null, deliveredAt: null, legacySnapshot: true, version: 1 })));
      expect((await db.query(`SELECT "shippingCarrier","shipmentTrackingNumber" FROM "Order" WHERE id='legacy'`)).rows[0]).toEqual({ shippingCarrier: null, shipmentTrackingNumber: null });
      const events = (await db.query(`SELECT kind,"occurredAt" FROM "FulfillmentEvent" ORDER BY sequence`)).rows; expect(events).toEqual([{ kind: "LEGACY_SNAPSHOT", occurredAt: null }, { kind: "LEGACY_SNAPSHOT", occurredAt: null }]);
      await db.query(`UPDATE "Product" SET "sellerId"='vendor-b' WHERE id='p-a'`);
      expect((await db.query(`SELECT f."sellerId" FROM "OrderItem" i JOIN "OrderFulfillment" f ON f.id=i."fulfillmentId" WHERE i.id='i-a'`)).rows[0].sellerId).toBe("vendor-a");
      await expect(db.query(`UPDATE "OrderItem" SET "fulfillmentId"=(SELECT "fulfillmentId" FROM "OrderItem" WHERE id='i-b') WHERE id='i-a'`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "FulfillmentEvent" SET kind='fabricated'`)).rejects.toBeDefined();
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"updatedAt") VALUES ('new','buyer',30,'PROCESSING',now())`);
      // New assignments capture the catalog owner at INSERT, including after
      // a direct test-only catalog transfer. Historical assignments stay fixed.
      await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"updatedAt") VALUES ('new-a','new','p-a',1,10,now()),('new-b','new','p-b',1,20,now())`);
      expect((await db.query(`SELECT count(*)::int AS n FROM "OrderFulfillment" WHERE "orderId"='new'`)).rows[0].n).toBe(1);
      await db.query(`UPDATE "Product" SET "sellerId"='vendor-a' WHERE id='p-a'`);
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"updatedAt") VALUES ('mixed','buyer',30,'PROCESSING',now())`);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"updatedAt") VALUES ('mixed-a','mixed','p-a',1,10,now()),('mixed-b','mixed','p-b',1,20,now())`);
      const groups = (await db.query(`SELECT id,"sellerId" FROM "OrderFulfillment" WHERE "orderId"='mixed' ORDER BY "sellerId"`)).rows;
      await expect(db.query(`UPDATE "OrderFulfillment" SET status='SHIPPED',carrier='Courier',"trackingNumber"='TRACK-1',"shippedAt"=timezone('UTC',now()),version=version+1 WHERE id=$1`, [groups[0].id])).rejects.toBeDefined();
      await db.query("BEGIN");
      try { await db.query(`UPDATE "OrderFulfillment" SET status='SHIPPED',carrier='Courier',"trackingNumber"='TRACK-1',"shippedAt"=timezone('UTC',now()),version=version+1 WHERE id=$1`, [groups[0].id]); await db.query(`UPDATE "Order" SET status='PARTIALLY_SHIPPED' WHERE id='mixed'`); await db.query("COMMIT"); } catch (error) { await db.query("ROLLBACK"); throw error; }
      expect((await db.query(`SELECT status FROM "OrderFulfillment" WHERE id=$1`, [groups[1].id])).rows[0].status).toBe("PROCESSING");
      await expect(db.query(`UPDATE "Order" SET status='CANCELLED' WHERE id='mixed'`)).rejects.toBeDefined();
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"paymentMethod","paymentStatus","updatedAt") VALUES ('card','buyer',10,'PENDING','STRIPE','UNPAID',now())`);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"updatedAt") VALUES ('card-a','card','p-a',1,10,now())`);
      await db.query(`UPDATE "Order" SET status='PROCESSING',"paymentStatus"='PAID' WHERE id='card'`); expect((await db.query(`SELECT status,version FROM "OrderFulfillment" WHERE "orderId"='card'`)).rows[0]).toEqual({ status: "PROCESSING", version: 2 });
      await db.query(`DELETE FROM "OrderItem" WHERE "orderId"='card'`); await db.query(`DELETE FROM "Order" WHERE id='card'`); expect((await db.query(`SELECT count(*)::int AS n FROM "OrderFulfillment" WHERE "orderId"='card'`)).rows[0].n).toBe(0);
    } finally { await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); } }
  }, 30_000);
});
