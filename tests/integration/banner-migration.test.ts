import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
const migration = "20261102110000_homepage_banners";
async function fixtureDatabase() {
  const name = `audit_banner_migration_${randomBytes(8).toString("hex")}`;
  if (!/^audit_banner_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid owned database name");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); let db: Client | undefined, created = false;
  const close = async () => { try { await db?.end(); if (created) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
    const root = join(process.cwd(), "prisma/migrations"), names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    return { db, sql: await readFile(join(root, migration, "migration.sql"), "utf8"), close };
  } catch (error) { await close(); throw error; }
}
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("banner migration on a fresh legacy fixture", () => {
  it("preserves existing banners and enforces revisions, ordered UTC evidence and retained delete history", async () => {
    const fixture = await fixtureDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "Banner"(id,title,subtitle,"imageUrl","linkUrl","isActive","createdAt") VALUES ('legacy','Legacy title','Original subtitle','/images/banner.png','/products',true,'2026-10-01 12:00:00')`);
      await db.query(fixture.sql);
      const saved = (await db.query(`SELECT title,subtitle,"imageUrl","linkUrl","isActive",placement,position,version,"createdAt"::text FROM "Banner" WHERE id='legacy'`)).rows[0];
      expect(saved).toEqual({ title: "Legacy title", subtitle: "Original subtitle", imageUrl: "/images/banner.png", linkUrl: "/products", isActive: true, placement: "HERO", position: 0, version: 1, createdAt: "2026-10-01 12:00:00" });
      await expect(db.query(`UPDATE "Banner" SET title='New title' WHERE id='legacy'`)).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`UPDATE "Banner" SET placement='UNKNOWN',version=version+1 WHERE id='legacy'`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`SET TIMEZONE='Asia/Dhaka'; UPDATE "Banner" SET placement='PROMO',position=4,version=version+1 WHERE id='legacy'; DELETE FROM "Banner" WHERE id='legacy'`);
      const events = (await db.query(`SELECT action,sequence,"before","after",EXTRACT(EPOCH FROM ("createdAt" AT TIME ZONE 'UTC'))::float8 AS instant FROM "BannerEvent" ORDER BY sequence`)).rows;
      expect(events.map((row) => row.action)).toEqual(["UPDATE", "DELETE"]); expect(events[0].before.placement).toBe("HERO"); expect(events[0].after.position).toBe(4); expect(Math.abs(events[1].instant * 1000 - Date.now())).toBeLessThan(10000);
      await expect(db.query(`DELETE FROM "BannerEvent"`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`INSERT INTO "BannerRequest"(id,"ownerId",hash,result) VALUES ($1,'admin',$2,'{"id":"legacy","version":2,"deleted":true}')`, [randomUUID(), "a".repeat(64)]);
      await expect(db.query(`UPDATE "BannerRequest" SET result='{}'`)).rejects.toMatchObject({ code: "23514" });
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
  it("rolls back incompatible legacy title bounds without altering the original banner", async () => {
    const fixture = await fixtureDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "Banner"(id,title,"imageUrl") VALUES ('legacy',$1,'/images/banner.png')`, ["x".repeat(161)]);
      await expect(db.query(fixture.sql)).rejects.toMatchObject({ code: "23514" }); await db.query("ROLLBACK");
      expect((await db.query(`SELECT title FROM "Banner" WHERE id='legacy'`)).rows[0].title).toHaveLength(161);
      expect((await db.query(`SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='Banner' AND column_name='version'`)).rows[0].count).toBe(0);
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
});
