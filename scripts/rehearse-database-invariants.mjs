import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { tsImport } from "tsx/esm/api";
import { createFinancialSmokeDatabase } from "./testing/finance-database.mjs";
import { INVARIANT_MIGRATION } from "./database-invariants-preflight.mjs";

// This runner never migrates the supplied database: the shared helper requires
// loopback audit_* and creates a new randomly named owned database first.
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
let fixture, client, applicationDatabase, phase = "owned baseline CLI installation";
const originalUrl = process.env.DATABASE_URL;
const evidence = {};
async function fingerprint() {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename");
  const result = {};
  for (const { tablename } of rows) {
    const data = await client.query(`SELECT count(*)::text AS rows,md5(COALESCE(string_agg(value,E'\\n' ORDER BY value),'')) AS digest FROM (SELECT to_jsonb(t)::text AS value FROM public.${quote(tablename)} t) contents`);
    result[tablename] = data.rows[0];
  }
  return result;
}
function preflight(expected = new URL(fixture.url).pathname.slice(1)) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve("scripts/audit-database-invariants.mjs")], {
      env: { ...process.env, DATABASE_URL: fixture.url, AUDIT_DATABASE_NAME: expected }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => reject(Error("Isolated preflight could not start.")));
    child.once("exit", (code) => done({ code, stdout, stderr }));
  });
}
async function failedUpgrade(rule, count) {
  const before = await fingerprint(), report = await preflight();
  assert.equal(report.code, 1); assert.equal(report.stderr, "");
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.status, "INVALID"); assert.equal(parsed.readOnly, true);
  assert.equal(parsed.rules.find((item) => item.rule === rule)?.affectedRows, String(count));
  assert.deepEqual(await fingerprint(), before, "Read-only preflight must preserve every public table");
  await assert.rejects(fixture.deploy(), /Isolated migration command failed/);
  assert.deepEqual(await fingerprint(), before, "Failed CLI upgrade must preserve every public table");
  assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname='User_role_domain'")).rows[0].count, 0);
  assert.equal((await client.query("SELECT to_regprocedure('public.marketplace_invariant_counts()') IS NULL AS absent")).rows[0].absent, true);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NULL AND rolled_back_at IS NULL', [INVARIANT_MIGRATION])).rows[0].count, 1);
  return { readOnly: true, affectedRows: count, atomicCliFailure: true, unchangedTables: Object.keys(before).length };
}
try {
  fixture = await createFinancialSmokeDatabase({ beforeMigration: INVARIANT_MIGRATION });
  const db = fixture.db;
  client = new Client({ connectionString: fixture.url }); await client.connect();
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count, 37);
  process.env.DATABASE_URL = fixture.url;
  const { prisma } = await tsImport("../lib/prisma.ts", import.meta.url); applicationDatabase = prisma;
  const { mutateSiteContent } = await tsImport("../lib/site-content.ts", import.meta.url);
  const { mutateFulfillment } = await tsImport("../lib/fulfillments.ts", import.meta.url);
  const { requestRefund, mutateRefundLocally } = await tsImport("../lib/refunds.ts", import.meta.url);
  phase = "real retained accounts, shipment finance and publication history";
  const [admin, seller, buyer] = await Promise.all(["ADMIN", "MEMBER", "USER"].map((role) => db.user.create({ data: { email: `${randomUUID()}@upgrade.example.invalid`, role, isVerified: true } })));
  const category = await db.category.create({ data: { name: "Upgrade evidence", slug: randomUUID() } });
  const product = await db.product.create({ data: { name: "Retained purchase", slug: randomUUID(), price: 100, stock: 20, status: "APPROVED", sellerId: seller.id, categoryId: category.id } });
  await db.sellerSettlementPolicy.create({ data: { id: randomUUID(), scopeKey: "GLOBAL", version: 1, commissionBps: 750, shippingRecipient: "SELLER", createdById: admin.id, reason: "Explicit isolated retained commercial terms" } });
  const order = await db.order.create({ data: { userId: buyer.id, total: 120, status: "PROCESSING", paymentMethod: "COD", trackingNumber: "HISTORICAL-TRACKING", subtotalCents: 10000n, discountCents: 0n, shippingCents: 2000n, pricingEvidence: "Isolated verified retained purchase", pricingReconciledAt: new Date(), items: { create: { productId: product.id, quantity: 1, price: 100, netCents: 10000n } } }, include: { fulfillments: true } });
  const shipment = order.fulfillments[0]; assert.ok(shipment);
  const shipped = await mutateFulfillment(seller, { fulfillmentId: shipment.id, version: shipment.version, action: "ship", carrier: "Isolated courier", trackingNumber: "LOCAL-RETAINED-PACKAGE" });
  await mutateFulfillment(admin, { fulfillmentId: shipment.id, version: shipped.shipment.version, action: "deliver", codMoneyReceived: true });
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus, "PAID");
  const collected = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  const refund = await requestRefund(admin, { orderId: order.id, version: collected.refundVersion, requestId: randomUUID(), reason: "Isolated delivered purchase reimbursement", selection: "FULL" });
  assert.equal(refund.refund.shippingCents, 0);
  await mutateRefundLocally(admin, { action: "confirm-cod", refundId: refund.refund.id, version: refund.refund.version, moneyReturned: true, method: "CASH", reference: "ISOLATED-RETAINED-REPAYMENT" });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 20, "Dispatched stock must not be restored by money confirmation");
  const page = { kind: "PAGE", slug: "about" };
  await mutateSiteContent(admin, { ...page, requestId: randomUUID(), version: 0, action: "DRAFT", reason: "Retain reviewed operator publication", fields: { title: "Retained operator information", summary: "Operator information retained across the database upgrade.", byline: "Isolated operator", sections: [{ heading: "Retained history", body: "This reviewed document must survive the migration unchanged." }] } });
  await mutateSiteContent(admin, { ...page, requestId: randomUUID(), version: 1, action: "PUBLISH", reason: "Publish the reviewed operator document", reviewed: true });
  for (let index = 0; index < 2; index++) await db.address.create({ data: { userId: buyer.id, fullName: "Isolated buyer", phone: "01700000000", street: `Isolated building ${index}`, city: "Dhaka", district: "Dhaka", isDefault: false } });
  const legacy = await db.order.create({ data: { userId: buyer.id, total: 0, trackingNumber: "DUPLICATE-LEGACY-CODE" } });
  const other = await db.order.create({ data: { userId: buyer.id, total: 0, trackingNumber: null } });
  const wrongTargetBefore = await fingerprint(), wrongTarget = await preflight("audit_intentionally_wrong_target");
  assert.equal(wrongTarget.code, 1); assert.equal(wrongTarget.stdout, ""); assert.ok(wrongTarget.stderr.includes("preflight unavailable"));
  assert.ok(!wrongTarget.stderr.includes(fixture.url)); assert.deepEqual(await fingerprint(), wrongTargetBefore);
  phase = "invalid identity blocks actual CLI upgrade without repair";
  await db.user.update({ where: { id: buyer.id }, data: { role: "UNRECONCILED_LEGACY_ROLE" } });
  evidence.invalidRole = await failedUpgrade("User.role", 1);
  // This is an explicit fixture-owner reconciliation against the saved known
  // role, never part of the production migration or automatic role inference.
  await db.user.update({ where: { id: buyer.id }, data: { role: buyer.role } });
  await fixture.resolveRolledBack(INVARIANT_MIGRATION);
  phase = "duplicate historical tracking blocks actual CLI upgrade without choosing an order";
  await db.order.update({ where: { id: other.id }, data: { trackingNumber: legacy.trackingNumber } });
  evidence.duplicateTracking = await failedUpgrade("Order.trackingDuplicates", 2);
  // The owned fixture has known original null tracking. Restore that exact
  // original value; real operators must establish their own reconciliation.
  await db.order.update({ where: { id: other.id }, data: { trackingNumber: null } });
  await fixture.resolveRolledBack(INVARIANT_MIGRATION);
  const clean = await preflight(); assert.equal(clean.code, 0); assert.equal(JSON.parse(clean.stdout).status, "VALID");
  phase = "valid existing-data CLI upgrade and exact history comparison";
  const before = await fingerprint(); await fixture.deploy(); const after = await fingerprint();
  assert.deepEqual(after, before);
  for (const table of ["User", "Product", "Order", "OrderItem", "OrderEvent", "OrderFulfillment", "SellerSettlementPolicy", "SellerSettlementSnapshot", "SellerLedgerEntry", "FinancialEvent", "Refund", "RefundLine", "SiteContent", "SiteContentRevision", "Address"]) assert.ok(Number(before[table].rows) > 0, `Missing retained fixture history: ${table}`);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count, 38);
  await fixture.deploy(); assert.deepEqual(await fingerprint(), before, "A second deploy must preserve all rows");
  evidence.validUpgrade = { allRowsAndTimestampsUnchanged: true, repeatedDeployUnchanged: true, tables: after };
  evidence.wrongTargetRejectedWithoutWrites = true;
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/database-invariant-upgrade.json", JSON.stringify(evidence, null, 2));
  console.log("Database invariant rehearsal: PASS; actual CLI baseline 37, atomic invalid/duplicate failures, explicit fixture reconciliation, upgrade 38 and all-table history preservation.");
} catch (error) {
  console.error(`Database invariant rehearsal failed during ${phase}; category ${error?.code ?? error?.name ?? "UNKNOWN"}. Private values withheld.`);
  process.exitCode = 1;
} finally {
  await applicationDatabase?.$disconnect(); await client?.end(); await fixture?.close();
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
}
