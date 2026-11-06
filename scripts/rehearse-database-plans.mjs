import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { INVARIANT_MIGRATION } from "./database-invariants-preflight.mjs";

const fixture = await createFinancialSmokeDatabase({ beforeMigration: INVARIANT_MIGRATION });
try {
  const db = fixture.db;
  const seller = await db.user.create({ data: { email: "plans@audit.example.invalid", role: "MEMBER", isVerified: true } });
  await db.user.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ email: `plan-buyer-${i}@audit.example.invalid`, role: "USER", isVerified: true })) });
  await db.category.createMany({ data: Array.from({ length: 80 }, (_, i) => ({ name: `Plan category ${i}`, slug: `plan-category-${i}` })) });
  await db.brand.createMany({ data: Array.from({ length: 80 }, (_, i) => ({ name: `Plan brand ${i}`, slug: `plan-brand-${i}` })) });
  await db.$executeRawUnsafe(`WITH c AS (SELECT id,row_number() OVER(ORDER BY id)-1 AS seq FROM "Category"),b AS (SELECT id,row_number() OVER(ORDER BY id)-1 AS seq FROM "Brand") INSERT INTO "Product"(id,name,slug,price,"discountPrice",stock,status,"sellerId","categoryId","brandId","createdAt","updatedAt") SELECT gen_random_uuid()::text,'Plan product '||g,'plan-product-'||g,100+(g%9000),CASE WHEN g%5=0 THEN 99+(g%9000) ELSE NULL END,50,CASE WHEN g%7=0 THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,$1,c.id,b.id,timestamp '2026-11-01'+(g%10000)*interval '1 second',timestamp '2026-11-01'+(g%10000)*interval '1 second' FROM generate_series(1,20000) g JOIN c ON c.seq=g%80 JOIN b ON b.seq=(g/80)%80`, seller.id);
  await db.$executeRawUnsafe(`INSERT INTO "Wishlist"(id,"userId","productId","createdAt") SELECT gen_random_uuid()::text,u.id,p.id,CURRENT_TIMESTAMP FROM "User" u CROSS JOIN (SELECT id FROM "Product" ORDER BY id LIMIT 100) p WHERE u.role='USER'`);
  for (const table of ["Product", "User", "Category", "Brand", "Wishlist"]) await db.$executeRawUnsafe(`ANALYZE "${table}"`);
  const category = await db.category.findFirst({ where: { products: { some: { status: "APPROVED" } } } }), brand = await db.brand.findFirst();
  const target = (await db.$queryRawUnsafe(`SELECT p.id FROM "Product" p WHERE NOT EXISTS(SELECT 1 FROM "Wishlist" w WHERE w."productId"=p.id) LIMIT 1`))[0].id;
  // Match the public catalog projection, joins, bound status filters and sorts.
  // Do not disable sequential scans or force planner choices.
  const select = `SELECT p.*,COALESCE(p."discountPrice",p.price) AS "effectivePrice",0::bigint AS "unitsSold",json_build_object('id',c.id,'name',c.name,'slug',c.slug) AS category,CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('id',b.id,'name',b.name,'slug',b.slug,'logo',b.logo) END AS brand,json_build_object('id',u.id,'name',u.name) AS seller FROM "Product" p JOIN "User" u ON u.id=p."sellerId" JOIN "Category" c ON c.id=p."categoryId" LEFT JOIN "Brand" b ON b.id=p."brandId" WHERE p.status=$1 AND u."sellerStatus"=$2`;
  const args = ["APPROVED", "APPROVED"], latest = 'p."createdAt" DESC,p.id ASC LIMIT 12';
  const queries = [
    { name: "category-latest", sql: select + ` AND p."categoryId"=$3 ORDER BY ${latest}`, args: [...args, category.id], index: "Product_category_status_created_id_idx" },
    { name: "brand-latest", sql: select + ` AND p."brandId"=$3 ORDER BY ${latest}`, args: [...args, brand.id], index: "Product_brand_status_created_id_idx" },
    { name: "public-latest", sql: select + ` ORDER BY ${latest}`, args, index: "Product_public_latest_idx" },
    { name: "public-price-low", sql: select + ` ORDER BY COALESCE(p."discountPrice",p.price) ASC,${latest}`, args, index: "Product_public_effective_price_idx" },
    { name: "public-price-high", sql: select + ` ORDER BY COALESCE(p."discountPrice",p.price) DESC,${latest}`, args, index: "Product_public_effective_price_idx" },
    { name: "public-rating", sql: select + ` ORDER BY p.rating DESC,p."reviewCount" DESC,${latest}`, args, index: "Product_public_rating_idx" },
    // Same child-reference lookup used for a restrictive Product FK check.
    { name: "wishlist-product-reference", sql: 'SELECT id FROM "Wishlist" WHERE "productId"=$1 LIMIT 1', args: [target], index: "Wishlist_productId_idx" },
  ];
  const summarize = (node) => [{ type: node["Node Type"], index: node["Index Name"] ?? null, rows: node["Actual Rows"], loops: node["Actual Loops"], removed: node["Rows Removed by Filter"] ?? 0, sharedHitBlocks: node["Shared Hit Blocks"] ?? 0, sharedReadBlocks: node["Shared Read Blocks"] ?? 0 }, ...(node.Plans ?? []).flatMap(summarize)];
  const run = async () => {
    const plans = [];
    for (const query of queries) {
      const result = await db.$queryRawUnsafe("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + query.sql, ...query.args), plan = result[0]["QUERY PLAN"][0];
      const rows = await db.$queryRawUnsafe(query.sql, ...query.args);
      plans.push({ name: query.name, executionMs: plan["Execution Time"], nodes: summarize(plan.Plan), ids: rows.map((row) => row.id) });
    }
    return plans;
  };
  const before = await run();
  // Apply the checked-in migration through the real CLI, not candidate DDL.
  await fixture.deploy();
  const after = await run();
  for (let index = 0; index < queries.length; index++) {
    assert.deepEqual(after[index].ids, before[index].ids, "Upgrade must preserve exact ordered results");
    assert.ok(after[index].nodes.some((node) => node.index === queries[index].index), `${queries[index].name} must exercise its reviewed index`);
  }
  assert.equal(await db.product.count(), 20000); assert.equal(await db.wishlist.count(), 10000);
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/database-invariant-plans.json", JSON.stringify({ postgresVersion: await db.$queryRawUnsafe("SELECT version() AS version"), fixture: { products: 20000, categories: 80, brands: 80, wishlists: 10000 }, before, after }, null, 2));
  for (let index = 0; index < queries.length; index++) console.log(JSON.stringify({ query: queries[index].name, expectedIndex: queries[index].index, beforeMs: before[index].executionMs, afterMs: after[index].executionMs, sameOrderedResults: true }));
} catch (error) {
  console.error(`Database plan rehearsal failed; category ${error?.code ?? error?.name ?? "UNKNOWN"}. Private values withheld.`); process.exitCode = 1;
} finally { await fixture.close(); }