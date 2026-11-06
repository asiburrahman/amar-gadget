import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("media lifecycle migration rehearsal on a fresh local database", () => {
  it("applies earlier SQL, preserves an existing product and adds a default media version and an empty durable queue", async () => {
    const name = `audit_media_${randomBytes(8).toString("hex")}`;
    if (!/^audit_media_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    // Global test setup already rejects remote, non-audit and overridden URLs.
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
      db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations");
      const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      const migration = "20261029120000_product_media_cleanup";
      expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('old-seller','old-seller@example.invalid',now())`);
      await db.query(`INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ('old-category','Old category','old-category',now())`);
      await db.query(`INSERT INTO "Product" (id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('old-product','Existing gadget','existing-gadget',123.45,3,'old-seller','old-category',now())`);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      const row = (await db.query(`SELECT id,name,price,stock,"mediaVersion" FROM "Product" WHERE id='old-product'`)).rows[0];
      expect(row).toEqual({ id: "old-product", name: "Existing gadget", price: "123.45", stock: 3, mediaVersion: 1 });
      expect((await db.query('SELECT count(*)::int AS total FROM "ProductImageCleanup"')).rows[0].total).toBe(0);
      await expect(db.query('UPDATE "Product" SET "mediaVersion"=0')).rejects.toBeDefined();
      const key = 'products/old-seller/00000000-0000-4000-8000-000000000001.png';
      await db.query('INSERT INTO "ProductImageCleanup" (key,"ownerId","availableAt") VALUES ($1,$2,now())', [key,'old-seller']);
      await expect(db.query('INSERT INTO "ProductImageCleanup" (key,"ownerId","availableAt") VALUES ($1,$2,now())', [key.replace('old-seller','another'),'old-seller'])).rejects.toBeDefined();
    } finally {
      await db?.end();
      try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); }
    }
  }, 30_000);
});
