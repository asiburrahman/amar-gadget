import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("refund ledger migration on a fresh isolated database", () => {
  it("preserves unknown historical pricing and enforces exact snapshots, immutable evidence and ledger counters", async () => {
    const name = `audit_refund_migration_${randomBytes(8).toString("hex")}`;
    if (!/^audit_refund_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    const control = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); let db: Client | undefined, created = false;
    try {
      await control.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma/migrations"), migration = "20261030150000_refund_ledger", names = (await readdir(root, { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).sort();
      for (const entry of names.filter((x) => x < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,role,"isVerified","updatedAt") VALUES ('vendor','vendor@example.invalid','MEMBER',true,now()),('buyer','buyer@example.invalid','USER',true,now()),('admin','admin@example.invalid','ADMIN',true,now())`);
      await db.query(`INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ('category','Category','category',now())`);
      await db.query(`INSERT INTO "Product" (id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('product','Product','product',100,10,'vendor','category',now())`);
      await db.query(`INSERT INTO "Order" (id,"userId",total,status,"paymentMethod","paymentStatus","updatedAt") VALUES ('legacy','buyer',100,'DELIVERED','COD','PAID',now())`);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"updatedAt") VALUES ('legacy-item','legacy','product',1,100,now())`);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT "subtotalCents","discountCents","shippingCents","refundedCents" FROM "Order" WHERE id='legacy'`)).rows[0]).toEqual({ subtotalCents: null, discountCents: null, shippingCents: null, refundedCents: "0" });
      expect((await db.query(`SELECT "netCents","retainedQuantity","refundedQuantity" FROM "OrderItem" WHERE id='legacy-item'`)).rows[0]).toEqual({ netCents: null, retainedQuantity: 1, refundedQuantity: 0 });
      await db.query("BEGIN");
      try {
        await db.query(`INSERT INTO "Order" (id,"userId",total,status,"paymentMethod","paymentStatus","subtotalCents","discountCents","shippingCents","pricingReconciledAt","updatedAt") VALUES ('priced','buyer',350,'PROCESSING','STRIPE','PAID',30000,10000,15000,timezone('UTC',now()),now())`);
        await db.query(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,price,"netCents","updatedAt") VALUES ('priced-item','priced','product',3,100,20000,now())`); await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); throw error; }
      await expect(db.query(`UPDATE "OrderItem" SET "netCents"=19999,"financialVersion"="financialVersion"+1 WHERE id='priced-item'`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "OrderItem" SET "refundedQuantity"=1,"financialVersion"="financialVersion"+1 WHERE id='priced-item'`)).rejects.toBeDefined();
      const refundId = randomUUID();
      await db.query("BEGIN");
      try {
        await db.query(`INSERT INTO "Refund" (id,"orderId","requestId","requestHash","createdById",reason,kind,status,"amountCents","shippingCents","paymentMethod","providerRefundId","appliedAt","updatedAt") VALUES ($1,'priced',$2,$3,'admin','Actual schema reimbursement','ITEMS','SUCCEEDED',11665,4999,'STRIPE','re_schema_fixture',timezone('UTC',now()),now())`, [refundId, randomUUID(), "a".repeat(64)]);
        await db.query(`INSERT INTO "RefundLine" (id,"refundId","orderItemId",quantity,"offset","amountCents","beforeDispatch") VALUES ($1,$2,'priced-item',1,0,6666,true)`, [randomUUID(), refundId]);
        await db.query(`UPDATE "OrderItem" SET "refundedQuantity"=1,"refundedCents"=6666,"voidedQuantity"=1,"financialVersion"="financialVersion"+1 WHERE id='priced-item'`);
        await db.query(`UPDATE "Order" SET "refundedCents"=11665,"shippingRefundedCents"=4999,"refundState"='PARTIAL',"refundVersion"="refundVersion"+1 WHERE id='priced'`); await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); throw error; }
      expect((await db.query(`SELECT "retainedQuantity","retainedCents","voidedQuantity" FROM "OrderItem" WHERE id='priced-item'`)).rows[0]).toEqual({ retainedQuantity: 2, retainedCents: "13334", voidedQuantity: 1 });
      await expect(db.query(`DELETE FROM "Refund" WHERE id=$1`, [refundId])).rejects.toBeDefined();
      await expect(db.query(`UPDATE "FinancialEvent" SET kind='fabricated'`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "Refund" SET "amountCents"=1,version=version+1 WHERE id=$1`, [refundId])).rejects.toBeDefined();
    } finally {
      await db?.end(); if (created) await control.query(`DROP DATABASE "${name}"`); await control.end();
    }
  }, 30_000);
});
