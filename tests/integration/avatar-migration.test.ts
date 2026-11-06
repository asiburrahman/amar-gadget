import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("owned avatar migration on a fresh local database", () => {
  it("preserves every historical value privately, removes inline User payloads and enforces owned URL/key/version pairs", async () => {
    const name = `audit_avatar_migration_${randomBytes(8).toString("hex")}`;
    if (!/^audit_avatar_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), migration = "20261030120000_owned_avatars";
      const names = (await readdir(root, { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).sort(); expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      const values = ["data:image/png;base64,private-historical-bytes", "https://old.cdn.invalid/profile.png?private=query", "https://cdn.invalid/avatars/old-looking/00000000-0000-4000-8000-000000000001.webp", ""];
      for (const [index, value] of values.entries()) await db.query('INSERT INTO "User" (id,email,avatar,"updatedAt") VALUES ($1,$2,$3,now())', [`old-${index}`, `old-${index}@example.invalid`, value]);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      const users = (await db.query('SELECT id,avatar,"avatarKey","avatarVersion" FROM "User" ORDER BY id')).rows;
      expect(users).toEqual(values.map((_, i) => ({ id: `old-${i}`, avatar: null, avatarKey: null, avatarVersion: 0 })));
      const backups = (await db.query('SELECT "userId",value FROM "UserAvatarLegacy" ORDER BY "userId"')).rows; expect(backups).toEqual(values.slice(0, 3).map((value, i) => ({ userId: `old-${i}`, value })));
      const key = "avatars/old-0/00000000-0000-4000-8000-000000000001.webp", publicUrl = `https://cdn.invalid/${key}`;
      for (const [photo, savedKey, version] of [[publicUrl, null, 1], [publicUrl.replace("old-0", "another"), key, 1], [publicUrl + "?signature=private", key, 1], [publicUrl, key, -1], ["data:image/png;base64,YQ==", key, 1]]) await expect(db.query('UPDATE "User" SET avatar=$1,"avatarKey"=$2,"avatarVersion"=$3 WHERE id=\'old-0\'', [photo, savedKey, version])).rejects.toBeDefined();
      await db.query('UPDATE "User" SET avatar=$1,"avatarKey"=$2,"avatarVersion"=1 WHERE id=\'old-0\'', [publicUrl, key]);
      await expect(db.query('INSERT INTO "AvatarImageCleanup" (key,"ownerId","availableAt") VALUES ($1,$2,now())', [key, "another"])).rejects.toBeDefined();
      await db.query('DELETE FROM "User" WHERE id=\'old-0\''); expect((await db.query('SELECT count(*)::int AS n FROM "UserAvatarLegacy" WHERE "userId"=\'old-0\'')).rows[0].n).toBe(0);
    } finally { await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); } }
  }, 30_000);
});
