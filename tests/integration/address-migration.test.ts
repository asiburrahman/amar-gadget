import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("saved address revision migration on a fresh isolated database", () => {
  it("preserves existing addresses and default uniqueness while adding guarded revision one", async () => {
    const name = `audit_address_${randomBytes(8).toString("hex")}`;
    if (!/^audit_address_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
      db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), migration = "20261029130000_address_revisions";
      const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('old-owner','old-owner@example.invalid',now())`);
      await db.query(`INSERT INTO "Address" (id,"userId","fullName",phone,street,city,district,"isDefault","updatedAt") VALUES ('old-address','old-owner','Old recipient','01700000000','Existing road','Dhaka','Dhaka',true,now())`);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT id,"fullName",street,"isDefault",version FROM "Address" WHERE id='old-address'`)).rows[0]).toEqual({ id: "old-address", fullName: "Old recipient", street: "Existing road", isDefault: true, version: 1 });
      await expect(db.query(`UPDATE "Address" SET version=0 WHERE id='old-address'`)).rejects.toBeDefined();
      await expect(db.query(`INSERT INTO "Address" (id,"userId","fullName",phone,street,city,district,"isDefault","updatedAt") VALUES ('duplicate','old-owner','Other recipient','01700000000','Other road','Dhaka','Dhaka',true,now())`)).rejects.toBeDefined();
    } finally {
      await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); }
    }
  }, 30_000);
});
