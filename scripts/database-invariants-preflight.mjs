import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const INVARIANT_MIGRATION = "20261105100000_database_invariants";
export const INVARIANT_BASELINE = "20261105090000_site_content_publication";

export function extractInvariantPreflight(source) {
  const parts = source.split("$audit_preflight$");
  if (parts.length !== 3) throw Error("The reviewed invariant query is unavailable.");
  const query = parts[1].trim();
  if (!/^WITH\s+users\s+AS\s*\(/i.test(query) || query.includes(";")) throw Error("The reviewed invariant query is invalid.");
  return query;
}

export async function invariantPreflightQuery() {
  return extractInvariantPreflight(await readFile(resolve("prisma/migrations", INVARIANT_MIGRATION, "migration.sql"), "utf8"));
}

/** The caller owns a PostgreSQL client and an explicit read-only transaction. */
export async function readInvariantCounts(client) {
  const { rows } = await client.query(await invariantPreflightQuery());
  if (rows.length !== 14 || new Set(rows.map((row) => row.rule)).size !== rows.length ||
    rows.some((row) => typeof row.rule !== "string" || !/^(User|Product|Order|OrderItem)\.[A-Za-z]+$/.test(row.rule) || !/^\d+$/.test(String(row.violations)))) {
    throw Error("Invariant count evidence is invalid.");
  }
  return rows.map((row) => ({ rule: row.rule, affectedRows: String(row.violations) }));
}
