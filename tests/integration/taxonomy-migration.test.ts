import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
const migration = "20261102090000_catalog_taxonomy";
async function legacyDatabase() {
  const name = `audit_taxonomy_migration_${randomBytes(8).toString("hex")}`;
  if (!/^audit_taxonomy_migration_[a-f0-9]{16}$/.test(name)) throw new Error("Invalid fixture name");
  const control = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); let created = false, db: Client | undefined;
  const close = async () => { try { await db?.end(); if (created) { await control.query(`DROP DATABASE "${name}"`); created = false; } } finally { await control.end(); } };
  try {
    await control.query(`CREATE DATABASE "${name}"`); created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`; db = new Client({ connectionString: url.toString() }); await db.connect();
    const root = join(process.cwd(), "prisma/migrations"), names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const entry of names.filter((entry) => entry < migration)) await db.query(await readFile(join(root, entry, "migration.sql"), "utf8"));
    return { db, sql: await readFile(join(root, migration, "migration.sql"), "utf8"), close };
  } catch (error) { await close(); throw error; }
}
(process.env.TEST_DATABASE_URL ? describe : describe.skip)("taxonomy upgrade with actual SQL, legacy data and restrictive deletion", () => {
  it("preserves legacy products, enforces hierarchy/revisions/aliases, retains evidence and protects in-use brands", async () => {
    const fixture = await legacyDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "User"(id,email,role,"updatedAt") VALUES ('vendor','taxonomy@example.invalid','MEMBER',now()); INSERT INTO "Category"(id,name,slug,image,"updatedAt") VALUES ('root','Existing root','old-root','https://legacy.example.invalid/kept.jpg',now()); INSERT INTO "Brand"(id,name,slug,"updatedAt") VALUES ('brand','Existing brand','old-brand',now()); INSERT INTO "Product"(id,name,slug,price,stock,"sellerId","categoryId","brandId","updatedAt") VALUES ('product','Kept product','kept-product',100,10,'vendor','root','brand',now())`);
      await db.query(fixture.sql);
      expect((await db.query(`SELECT name,slug,image,version,"parentId" FROM "Category" WHERE id='root'`)).rows[0]).toEqual({ name: "Existing root", slug: "old-root", image: "https://legacy.example.invalid/kept.jpg", version: 1, parentId: null });
      await db.query(`INSERT INTO "Category"(id,name,slug,"parentId","updatedAt") VALUES ('child','Accessories','child','root',now()),('root-two','Second root','root-two',NULL,now()),('child-two','Accessories','child-two','root-two',now())`);
      await expect(db.query(`INSERT INTO "Category"(id,name,slug,"parentId","updatedAt") VALUES ('duplicate',' accessories ','duplicate','root',now())`)).rejects.toMatchObject({ code: "23505" });
      await expect(db.query(`UPDATE "Category" SET "parentId"='child',version=version+1 WHERE id='root'`)).rejects.toMatchObject({ code: "23514" });
      await expect(db.query(`UPDATE "Category" SET name='No revision' WHERE id='root'`)).rejects.toMatchObject({ code: "23514" });
      await db.query(`UPDATE "Category" SET slug='new-root',version=version+1 WHERE id='root'; UPDATE "Brand" SET slug='new-brand',version=version+1 WHERE id='brand'`);
      expect((await db.query(`SELECT "categoryId" FROM "CategoryAlias" WHERE slug='old-root'`)).rows[0].categoryId).toBe("root");
      expect((await db.query(`SELECT "brandId" FROM "BrandAlias" WHERE slug='old-brand'`)).rows[0].brandId).toBe("brand");
      await expect(db.query(`INSERT INTO "Category"(id,name,slug,"updatedAt") VALUES ('alias-thief','Different','OLD-ROOT',now())`)).rejects.toMatchObject({ code: "23505" });
      await expect(db.query(`DELETE FROM "Brand" WHERE id='brand'`)).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) });
      await expect(db.query(`DELETE FROM "Category" WHERE id='root-two'`)).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) });
      await db.query(`UPDATE "Category" SET slug='old-root',version=version+1 WHERE id='root'; UPDATE "Category" SET slug='OLD-ROOT',version=version+1 WHERE id='root'; UPDATE "Category" SET slug='third-root',version=version+1 WHERE id='root'`);
      expect((await db.query(`SELECT "categoryId" FROM "CategoryAlias" WHERE lower(slug)='old-root'`)).rows[0].categoryId).toBe("root");
      expect((await db.query(`SELECT "categoryId","brandId" FROM "Product" WHERE id='product'`)).rows[0]).toEqual({ categoryId: "root", brandId: "brand" });
      await expect(db.query(`DELETE FROM "TaxonomyEvent"`)).rejects.toMatchObject({ code: "23514" });
      const requestId = randomUUID(); await db.query(`INSERT INTO "TaxonomyRequest"(id,"ownerId",hash,result) VALUES ($1,'admin',$2,'{"id":"root"}')`, [requestId, "a".repeat(64)]);
      await expect(db.query(`UPDATE "TaxonomyRequest" SET result='{}' WHERE id=$1`, [requestId])).rejects.toMatchObject({ code: "23514" });
      await db.query(`SET TIMEZONE='Asia/Dhaka'; UPDATE "Brand" SET name='Reviewed brand',version=version+1 WHERE id='brand'`);
      const [event] = (await db.query(`SELECT EXTRACT(EPOCH FROM ("createdAt" AT TIME ZONE 'UTC'))::float8 AS instant FROM "TaxonomyEvent" WHERE kind='brand' ORDER BY "createdAt" DESC,id DESC LIMIT 1`)).rows;
      expect(Math.abs(event.instant * 1000 - Date.now())).toBeLessThan(10_000);
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
  it("fails safely on pre-existing case-fold collisions instead of silently merging identities", async () => {
    const fixture = await legacyDatabase(), db = fixture.db;
    try {
      await db.query(`INSERT INTO "Brand"(id,name,slug,"updatedAt") VALUES ('one','First','Legacy',now()),('two','Second','legacy',now())`);
      await expect(db.query(fixture.sql)).rejects.toMatchObject({ code: "23505" }); await db.query("ROLLBACK");
      expect((await db.query(`SELECT count(*)::integer AS count FROM "Brand"`)).rows[0].count).toBe(2);
      expect((await db.query(`SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='Category' AND column_name='version'`)).rows[0].count).toBe(0);
    } finally { await db.query("ROLLBACK"); await fixture.close(); }
  }, 30_000);
});
