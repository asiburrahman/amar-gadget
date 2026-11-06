import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("cart persistence and guest receipt migration rehearsal", () => {
  it("preserves historical orders and six-key receipts while adding guarded account/guest storage", async () => {
    const name = `audit_cart_rehearsal_${randomBytes(8).toString("hex")}`;
    if (!/^audit_cart_rehearsal_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect(); let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), first = "20261029150000_cart_persistence", second = "20261029160000_guest_cart_receipts";
      const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); expect(names).toContain(first); expect(names).toContain(second);
      for (const entry of names.filter((entry) => entry < first)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('old-owner','old-owner@example.invalid',now())`);
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"updatedAt") VALUES ('old-order','old-owner',230,'PROCESSING',now())`);
      await db.query(await readFile(join(root, first, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT id,total,"cartSnapshot","cartConsumedAt" FROM "Order" WHERE id='old-order'`)).rows[0]).toMatchObject({ id: "old-order", total: "230.00", cartSnapshot: null, cartConsumedAt: null });
      expect((await db.query(`SELECT count(*)::int AS count FROM "Cart"`)).rows[0].count).toBe(0);
      const productId = randomUUID(), lineId = randomUUID(), sourceId = randomUUID();
      const oldReceipt = { ownerId: null, sourceId, version: 1, couponVersion: 0, couponCode: null, lines: [{ productId, lineId, quantity: 1 }] };
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"cartSnapshot","updatedAt") VALUES ('six-key-order','old-owner',230,'PROCESSING',$1::jsonb,now())`, [JSON.stringify(oldReceipt)]);
      await db.query(await readFile(join(root, second, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT "cartSnapshot","cartAcknowledgedAt" FROM "Order" WHERE id='six-key-order'`)).rows[0]).toEqual({ cartSnapshot: oldReceipt, cartAcknowledgedAt: null });
      await db.query(`INSERT INTO "Cart" ("userId","updatedAt") VALUES ('old-owner',now())`);
      await db.query(`INSERT INTO "CartLine" (id,"cartUserId","productId",quantity,"updatedAt") VALUES ($1,'old-owner',$2,2,now())`, [lineId, productId]);
      // Product ID is intentionally a soft reference: deletion/unavailability
      // must not silently remove the user's saved line or reset cart identity.
      expect((await db.query(`SELECT quantity,version FROM "CartLine" WHERE id=$1`, [lineId])).rows[0]).toEqual({ quantity: 2, version: 1 });
      await expect(db.query(`UPDATE "CartLine" SET quantity=101 WHERE id=$1`, [lineId])).rejects.toBeDefined();
      await expect(db.query(`INSERT INTO "CartLine" (id,"cartUserId","productId",quantity,"updatedAt") VALUES ('duplicate','old-owner',$1,1,now())`, [productId])).rejects.toBeDefined();
      await expect(db.query(`UPDATE "Cart" SET "lastRequestId"='incomplete' WHERE "userId"='old-owner'`)).rejects.toBeDefined();
      const nextReceipt = { ...oldReceipt, version: 2, previousReceiptId: randomUUID() };
      await expect(db.query(`INSERT INTO "Order" (id,"userId",total,status,"cartSnapshot","updatedAt") VALUES ('duplicate-source','old-owner',230,'PROCESSING',$1::jsonb,now())`, [JSON.stringify(nextReceipt)])).rejects.toBeDefined();
      await db.query(`UPDATE "Order" SET "cartAcknowledgedAt"=now() WHERE id='six-key-order'`);
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"cartSnapshot","updatedAt") VALUES ('modern-order','old-owner',230,'PROCESSING',$1::jsonb,now())`, [JSON.stringify(nextReceipt)]);
      expect((await db.query(`SELECT cart_snapshot_valid($1::jsonb) AS valid`, [JSON.stringify({ ...nextReceipt, unexpected: true })])).rows[0].valid).toBe(false);
      const indexes = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('Order','CartLine')`)).rows.map((row: { indexname: string }) => row.indexname);
      expect(indexes).toEqual(expect.arrayContaining(["Order_one_active_account_cart", "Order_one_unacknowledged_guest_cart", "Order_guest_cart_history_idx", "Order_userId_createdAt_idx", "CartLine_cartUserId_createdAt_id_idx"]));
    } finally { await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); } }
  }, 30_000);
});
