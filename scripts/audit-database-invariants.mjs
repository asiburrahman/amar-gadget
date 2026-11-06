import { Client } from "pg";
import { INVARIANT_BASELINE, readInvariantCounts } from "./database-invariants-preflight.mjs";

let client;
try {
  const url = new URL(process.env.DATABASE_URL ?? ""), expected = process.env.AUDIT_DATABASE_NAME;
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !expected ||
    decodeURIComponent(url.pathname.slice(1)) !== expected || url.hash) throw Error("Explicit preflight target required.");
  client = new Client({ connectionString: url.toString(), application_name: "amar-invariant-preflight", connectionTimeoutMillis: 3000, query_timeout: 30_000, statement_timeout: 30_000 });
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL search_path=pg_catalog,public");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const target = await client.query("SELECT current_database() AS name");
  if (target.rows[0]?.name !== expected) throw Error("Preflight target mismatch.");
  const baseline = await client.query('SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [INVARIANT_BASELINE]);
  if (baseline.rowCount !== 1) throw Error("Preflight baseline unavailable.");
  const rules = await readInvariantCounts(client), valid = rules.every((row) => row.affectedRows === "0");
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ status: valid ? "VALID" : "INVALID", readOnly: true, rules }));
  if (!valid) process.exitCode = 1;
} catch {
  try { await client?.query("ROLLBACK"); } catch { /* Preserve the safe unavailable result. */ }
  console.error("Database invariant preflight unavailable. Check the explicit AUDIT_DATABASE_NAME, connection and completed migration 37. No private values or row contents were printed.");
  process.exitCode = 1;
} finally { await client?.end().catch(() => undefined); }
