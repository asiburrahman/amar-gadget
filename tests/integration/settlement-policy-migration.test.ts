import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
const migration = "20261103090000_settlement_policy_snapshots";
async function createFixture() {
  const input = new URL(process.env.TEST_DATABASE_URL!);
  if (!["postgres:", "postgresql:"].includes(input.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(input.hostname) || !input.pathname.startsWith("/audit_")) throw new Error("Use a local isolated audit database.");
  const name = `audit_settlement_policy_${randomBytes(8).toString("hex")}`, control = new Client({ connectionString: input.toString() });
  await control.connect(); let created = false, db: Client | undefined;
  const close = async () => { try { await db?.end(); if (created && /^audit_settlement_policy_[a-f0-9]{16}$/.test(name)) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; input.pathname = `/${name}`; db = new Client({ connectionString: input.toString() }); await db.connect();
    const root = join(process.cwd(), "prisma/migrations"), entries = (await readdir(root, { withFileTypes: true })).filter((row) => row.isDirectory()).map((row) => row.name).sort();
    for (const entry of entries.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    return { db, sql: await readFile(join(root, migration, "migration.sql"), "utf8"), close };
  } catch (error) { await close(); throw error; }
}
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("commercial terms migration and PostgreSQL capture", () => {
  it("preserves unconfigured legacy purchases, captures effective new terms, restores inheritance and prevents retroactive replacement", async () => {
    const fixture = await createFixture(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "User"(id,email,role,"isVerified","updatedAt") VALUES ('admin','admin@settlement.example.invalid','ADMIN',true,now()),('seller','seller@settlement.example.invalid','MEMBER',true,now()),('other','other@settlement.example.invalid','MEMBER',true,now()); INSERT INTO "Category"(id,name,slug,"updatedAt") VALUES ('category','Policy migration','policy-migration',now()); INSERT INTO "Product"(id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('product','Purchased product','purchased-product',100,10,'seller','category',now()); INSERT INTO "Order"(id,"userId",total,"updatedAt") VALUES ('legacy-order','seller',100,now()); INSERT INTO "OrderItem"(id,"orderId","productId",quantity,price,"updatedAt") VALUES ('legacy-line','legacy-order','product',1,100,now())`);
      await db.query(`INSERT INTO "Order"(id,"userId",total,status,"paymentMethod","paymentStatus","subtotalCents","discountCents","shippingCents","pricingEvidence","pricingReconciledAt","updatedAt") VALUES ('legacy-paid','seller',100,'DELIVERED','COD','PAID',10000,0,0,'Actual legacy purchase amounts',now(),now()); INSERT INTO "OrderItem"(id,"orderId","productId",quantity,price,"netCents","updatedAt") VALUES ('legacy-paid-line','legacy-paid','product',1,100,10000,now())`);
      const legacyPaid = (await db.query(`SELECT row_to_json(o) AS value FROM "Order" o WHERE id='legacy-paid'`)).rows[0].value;
      await db.query(fixture.sql);
      const snapshot = async (id: string) => (await db.query(`SELECT * FROM "SellerSettlementSnapshot" WHERE "orderId"=$1`, [id])).rows[0];
      const legacy = await snapshot("legacy-order"); expect(legacy).toMatchObject({ policyId: null, origin: "LEGACY_UNCONFIGURED", version: 1, adoptedAt: null });
      const policy = async (scope: string, version: number, commissionBps: number | null, shippingRecipient: string | null) => {
        const id = randomUUID(); await db.query(`INSERT INTO "SellerSettlementPolicy"(id,"scopeKey",version,"commissionBps","shippingRecipient","createdById",reason) VALUES ($1,$2,$3,$4,$5,'admin','Actual configured commercial terms')`, [id, scope, version, commissionBps, shippingRecipient]); return id;
      };
      const purchase = async (id: string) => { await db.query(`INSERT INTO "Order"(id,"userId",total,"updatedAt") VALUES ($1,'seller',100,now())`, [id]); await db.query(`INSERT INTO "OrderItem"(id,"orderId","productId",quantity,price,"updatedAt") VALUES ($1,$2,'product',1,100,now())`, [`${id}-line`, id]); return snapshot(id); };
      expect(await purchase("unconfigured-checkout")).toMatchObject({ policyId: null, origin: "CHECKOUT" });
      await expect(policy("GLOBAL", 1, null, null)).rejects.toMatchObject({ code: "23514" });
      const global = await policy("GLOBAL", 1, 1250, "PLATFORM"); expect(await purchase("global-checkout")).toMatchObject({ policyId: global, origin: "CHECKOUT" });
      const override = await policy("SELLER:seller", 1, 500, "SELLER"); expect(await purchase("override-checkout")).toMatchObject({ policyId: override });
      const futureGlobal = await policy("GLOBAL", 2, 2500, "SELLER"); expect(await purchase("still-override")).toMatchObject({ policyId: override });
      await policy("SELLER:seller", 2, null, null); expect(await purchase("inherited-checkout")).toMatchObject({ policyId: futureGlobal });
      expect(await snapshot("global-checkout")).toMatchObject({ policyId: global, version: 1 }); expect(await snapshot("legacy-order")).toMatchObject({ policyId: null }); expect(await snapshot("unconfigured-checkout")).toMatchObject({ policyId: null });
      const foreign = await policy("SELLER:other", 1, 1000, "SELLER");
      const adopt = (target: string, id: string, actor = "admin", reason: string | null = "Reviewed actual legacy commercial agreement") => db.query(`UPDATE "SellerSettlementSnapshot" SET "policyId"=$1,version=version+1,"adoptedById"=$2,"adoptionReason"=$3 WHERE "orderId"=$4`, [id, actor, reason, target]);
      await expect(adopt("legacy-order", foreign)).rejects.toMatchObject({ code: "23514" }); await expect(adopt("legacy-order", global, "seller")).rejects.toMatchObject({ code: "23514" }); await expect(adopt("legacy-order", global, "admin", null)).rejects.toMatchObject({ code: "23514" });
      await db.query(`SET TIMEZONE='Asia/Dhaka'`); await adopt("legacy-order", global); const adopted = await snapshot("legacy-order"); expect(adopted).toMatchObject({ policyId: global, version: 2, origin: "LEGACY_UNCONFIGURED", adoptedById: "admin" });
      const instant = (await db.query(`SELECT EXTRACT(EPOCH FROM ("adoptedAt" AT TIME ZONE 'UTC'))::float8 AS instant FROM "SellerSettlementSnapshot" WHERE "orderId"='legacy-order'`)).rows[0].instant; expect(Math.abs(instant * 1000 - Date.now())).toBeLessThan(10000);
      await expect(adopt("legacy-order", futureGlobal)).rejects.toMatchObject({ code: "23514" }); await expect(adopt("global-checkout", futureGlobal)).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`UPDATE "SellerSettlementPolicy" SET "commissionBps"=0 WHERE id=$1`, [global])).rejects.toMatchObject({ code: "23514" }); await expect(db.query(`DELETE FROM "SellerSettlementPolicy" WHERE id=$1`, [global])).rejects.toMatchObject({ code: "23514" }); await expect(db.query(`DELETE FROM "SellerSettlementSnapshot" WHERE "orderId"='legacy-order'`)).rejects.toMatchObject({ code: "23514" });
      await expect(policy("GLOBAL", 2, 1000, "SELLER")).rejects.toMatchObject({ code: "23514" }); await expect(policy("SELLER:missing", 1, 1000, "SELLER")).rejects.toMatchObject({ code: "23514" });
      const root = join(process.cwd(), "prisma/migrations"), remaining = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name > migration).map((entry) => entry.name).sort();
      for (const next of remaining) await db.query(await readFile(join(root, next, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT row_to_json(o) AS value FROM "Order" o WHERE id='legacy-paid'`)).rows[0].value).toEqual(legacyPaid);
      expect((await db.query(`SELECT "balanceCents" FROM "SellerWallet" WHERE "sellerId"='seller'`)).rows[0].balanceCents).toBe("0");
      expect((await db.query(`SELECT projection FROM "SellerAccrual" WHERE "orderId"='legacy-paid'`)).rows[0].projection).toMatchObject({ availableCents: "0", holds: ["POLICY_REQUIRED"] });
      await adopt("legacy-paid", futureGlobal);
      expect((await db.query(`SELECT "balanceCents" FROM "SellerWallet" WHERE "sellerId"='seller'`)).rows[0].balanceCents).toBe("7500");
      expect((await db.query(`SELECT "productName",price,"netCents" FROM "OrderItem" WHERE id='legacy-paid-line'`)).rows[0]).toEqual({ productName: "Purchased product", price: "100.00", netCents: "10000" });
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
});
