import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("campaign migration rehearsal", () => {
  it("preserves existing catalog data, bounds membership and cascades only campaign relationships", async () => {
    const name = `audit_campaign_${randomBytes(8).toString("hex")}`;
    if (!/^audit_campaign_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture database name");
    const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
    let db: Client | undefined, created = false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
      const root = join(process.cwd(), "prisma", "migrations"), migration = "20261029110000_catalog_campaigns";
      const names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); expect(names).toContain(migration);
      for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
      await db.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('seller','seller@example.invalid',now())`);
      await db.query(`INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ('category','Existing category','existing-category',now())`);
      await db.query(`INSERT INTO "Product" (id,name,slug,price,stock,"sellerId","categoryId","updatedAt") VALUES ('product','Existing gadget','existing-gadget',123.45,3,'seller','category',now())`);
      await db.query(await readFile(join(root, migration, "migration.sql"), "utf8"));
      expect((await db.query(`SELECT price,stock,specifications FROM "Product" WHERE id='product'`)).rows[0]).toEqual({ price: "123.45", stock: 3, specifications: [] });
      expect((await db.query(`SELECT count(*)::int AS count FROM "Campaign"`)).rows[0].count).toBe(0);
      await db.query(`INSERT INTO "Campaign" (id,title,slug,"startsAt","endsAt","updatedAt") VALUES ('campaign','Real collection','real-collection','2026-10-01','2026-11-01',now())`);
      await db.query(`INSERT INTO "CampaignProduct" ("campaignId","productId",position) VALUES ('campaign','product',0)`);
      await expect(db.query(`UPDATE "CampaignProduct" SET position=50 WHERE "campaignId"='campaign'`)).rejects.toBeDefined();
      await expect(db.query(`UPDATE "Campaign" SET "endsAt"="startsAt" WHERE id='campaign'`)).rejects.toBeDefined();
      await db.query(`DELETE FROM "Campaign" WHERE id='campaign'`);
      expect((await db.query(`SELECT count(*)::int AS count FROM "CampaignProduct"`)).rows[0].count).toBe(0);
      expect((await db.query(`SELECT count(*)::int AS count FROM "Product" WHERE id='product'`)).rows[0].count).toBe(1);
    } finally { await db?.end(); try { if (created) await admin.query(`DROP DATABASE "${name}"`); } finally { await admin.end(); } }
  }, 30_000);
});
