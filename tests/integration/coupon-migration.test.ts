import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
const migration = "20261102100000_coupon_administration";
async function fixtureDatabase() {
  const name = `audit_coupon_migration_${randomBytes(8).toString("hex")}`;
  if (!/^audit_coupon_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid owned database name");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); let db: Client | undefined, created = false;
  const close = async () => { try { await db?.end(); if (created) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
    const root = join(process.cwd(), "prisma/migrations"), names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    return { db, sql: await readFile(join(root, migration, "migration.sql"), "utf8"), close };
  } catch (error) { await close(); throw error; }
}
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("coupon upgrade on a new isolated legacy database", () => {
  it("preserves rules, protects purchased codes and enforces revisions, monetary constraints and immutable UTC evidence", async () => {
    const fixture = await fixtureDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "Coupon"(id,code,discount,"isPercentage","minSpend") VALUES ('coupon','LEGACY-SALE',12.35,true,900)`);
      await db.query(`INSERT INTO "User"(id,email,"updatedAt") VALUES ('buyer','coupon-migration@example.invalid',now()); INSERT INTO "Order"(id,"userId",total,status,"paymentMethod","paymentStatus","couponCode","updatedAt") VALUES ('purchase','buyer',100,'PENDING','STRIPE','UNPAID','LEGACY-SALE',now())`);
      await db.query(fixture.sql);
      expect((await db.query(`SELECT discount,"minSpend",version FROM "Coupon" WHERE id='coupon'`)).rows[0]).toEqual({ discount: "12.35", minSpend: "900.00", version: 1 });
      await expect(db.query(`UPDATE "Coupon" SET discount=20 WHERE id='coupon'`)).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`UPDATE "Coupon" SET code='REPLACED',version=version+1 WHERE id='coupon'`)).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`DELETE FROM "Coupon" WHERE id='coupon'`)).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`UPDATE "Order" SET "couponCode"=NULL WHERE id='purchase'`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`SET TIMEZONE='Asia/Dhaka'; UPDATE "Coupon" SET discount=20,"isActive"=false,version=version+1 WHERE id='coupon'`);
      const event = (await db.query(`SELECT sequence,"before","after",EXTRACT(EPOCH FROM ("createdAt" AT TIME ZONE 'UTC'))::float8 AS instant FROM "CouponEvent" WHERE "couponId"='coupon'`)).rows[0];
      expect(event.before.discount).toBe(12.35); expect(event.after.discount).toBe(20); expect(Math.abs(event.instant * 1000 - Date.now())).toBeLessThan(10_000);
      expect((await db.query(`SELECT total,"couponCode" FROM "Order" WHERE id='purchase'`)).rows[0]).toEqual({ total: "100.00", couponCode: "LEGACY-SALE" });
      for (const [code, discount, percentage, minimum] of [["BAD-PERCENT", 101, true, null], ["BAD-MONEY", -1, false, null], ["BAD-MIN", 5, false, -1], [" lower ", 5, false, null]]) await expect(db.query(`INSERT INTO "Coupon"(id,code,discount,"isPercentage","minSpend") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), code, discount, percentage, minimum])).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`DELETE FROM "CouponEvent"`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`INSERT INTO "CouponRequest"(id,"ownerId",hash,result) VALUES ($1,'admin',$2,'{"id":"coupon","version":2}')`, [randomUUID(), "a".repeat(64)]);
      await expect(db.query(`UPDATE "CouponRequest" SET result='{}'`)).rejects.toMatchObject({ code: "23514" });
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
  it("rolls back an upgrade with invalid legacy rules without clamping discounts or modifying data", async () => {
    const fixture = await fixtureDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "Coupon"(id,code,discount,"isPercentage") VALUES ('legacy','LEGACY',126,true)`);
      await expect(db.query(fixture.sql)).rejects.toMatchObject({ code: "23514" }); await db.query("ROLLBACK");
      expect((await db.query(`SELECT discount FROM "Coupon" WHERE id='legacy'`)).rows[0].discount).toBe("126.00");
      expect((await db.query(`SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='Coupon' AND column_name='version'`)).rows[0].count).toBe(0);
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
});
