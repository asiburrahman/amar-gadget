import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
const migration = "20261102120000_account_administration";
async function fixtureDatabase() {
  const name = `audit_account_migration_${randomBytes(8).toString("hex")}`;
  if (!/^audit_account_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid owned database name");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); let db: Client | undefined, created = false;
  const close = async () => { try { await db?.end(); if (created) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true; const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
    const root = join(process.cwd(), "prisma/migrations"), names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    return { db, sql: await readFile(join(root, migration, "migration.sql"), "utf8"), close };
  } catch (error) { await close(); throw error; }
}
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("account administration migration on a fresh legacy fixture", () => {
  it("preserves accounts and advances security revisions with redacted immutable UTC evidence", async () => {
    const fixture = await fixtureDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "User"(id,email,name,password,role,"sellerStatus","isVerified","sessionVersion","createdAt","updatedAt") VALUES ('legacy','account-migration@example.invalid','Original name','private-original-fixture-hash','MEMBER','PENDING',true,7,'2026-10-01 12:00:00',now())`);
      await db.query(fixture.sql);
      expect((await db.query(`SELECT email,name,password,role,"sellerStatus","isVerified","sessionVersion","administrationVersion","createdAt"::text FROM "User" WHERE id='legacy'`)).rows[0]).toEqual({ email: "account-migration@example.invalid", name: "Original name", password: "private-original-fixture-hash", role: "MEMBER", sellerStatus: "PENDING", isVerified: true, sessionVersion: 7, administrationVersion: 1, createdAt: "2026-10-01 12:00:00" });
      await db.query(`UPDATE "User" SET name='Profile-only change',"administrationVersion"=999 WHERE id='legacy'`); expect((await db.query(`SELECT "administrationVersion" FROM "User" WHERE id='legacy'`)).rows[0].administrationVersion).toBe(1);
      await db.query(`SET TIMEZONE='Asia/Dhaka'; UPDATE "User" SET password='private-new-fixture-hash' WHERE id='legacy'`);
      await db.query(`SELECT set_config('amar.account_admin_actor_id','operator',false),set_config('amar.account_admin_reason','Actual reviewed moderation',false)`);
      await db.query(`UPDATE "User" SET role='USER',"sellerStatus"='BLOCKED',"sessionVersion"="sessionVersion"+1 WHERE id='legacy'`);
      const events = (await db.query(`SELECT sequence,"actorId",reason,"before","after",EXTRACT(EPOCH FROM ("createdAt" AT TIME ZONE 'UTC'))::float8 AS instant FROM "AccountAdminEvent" ORDER BY sequence`)).rows;
      expect(events).toHaveLength(2); expect(events[0]).toMatchObject({ actorId: null, reason: null, before: { version: 1, sessionVersion: 7 }, after: { version: 2, sessionVersion: 8 } }); expect(events[1]).toMatchObject({ actorId: "operator", reason: "Actual reviewed moderation", before: { role: "MEMBER", sessionVersion: 8 }, after: { role: "USER", sessionVersion: 9, version: 3 } });
      expect(JSON.stringify(events)).not.toContain("private-"); expect(JSON.stringify(events)).not.toContain("password"); expect(Math.abs(events[1].instant * 1000 - Date.now())).toBeLessThan(10000);
      await expect(db.query(`DELETE FROM "AccountAdminEvent"`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`INSERT INTO "AccountAdminRequest"(id,"ownerId",hash,result) VALUES ($1,'operator',$2,'{"id":"legacy","version":3,"sessionChanged":false}')`, [randomUUID(), "a".repeat(64)]);
      await expect(db.query(`UPDATE "AccountAdminRequest" SET result='{}'`)).rejects.toMatchObject({ code: "23514" });
      const indexes = (await db.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('User_role_createdAt_id_idx','User_createdAt_id_idx','Order_createdAt_id_idx')`)).rows; expect(indexes).toHaveLength(3);
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
});
