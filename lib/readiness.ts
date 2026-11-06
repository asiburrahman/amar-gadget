import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateRuntimeConfig } from "@/config/runtime";
import { getRedisClient } from "@/lib/redis";
import { REQUIRED_SCHEMA_MIGRATION } from "@/lib/database-schema";
import { reportOperationFailure } from "@/lib/observability";
import { otpClockGuard } from "@/lib/otp-clock-guard";
import { databaseInvariantGuard } from "@/lib/database-invariant-guard";

let database: PrismaClient | undefined;
let cached: { expires: number; result: ReadinessResult } | undefined;
let pending: Promise<ReadinessResult> | undefined;
type ReadinessResult = { status: "READY" | "UNAVAILABLE"; checks: { configuration: boolean; database: boolean; redis: boolean }; references?: Partial<Record<"configuration" | "database" | "redis", string>> };

async function probe(): Promise<ReadinessResult> {
  const checks = { configuration: false, database: false, redis: false };
  const references: NonNullable<ReadinessResult["references"]> = {};
  const failed = (check: keyof typeof checks, error: unknown) => { references[check] = reportOperationFailure(`readiness.${check}`, error).reference; };
  try {
    const config = validateRuntimeConfig();
    checks.configuration = true;
    database ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL, max: 1, connectionTimeoutMillis: 1500, idleTimeoutMillis: 1000, query_timeout: 1500, statement_timeout: 1500, allowExitOnIdle: true }), log: [] });
  } catch (error) { failed("configuration", error); return { status: "UNAVAILABLE", checks, references }; }
  await Promise.allSettled([
    (async () => {
      try {
      const rows = await database!.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${REQUIRED_SCHEMA_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND ${otpClockGuard} AND ${databaseInvariantGuard} LIMIT 1`;
      if (rows.length !== 1) throw Object.assign(Error("Required schema is unavailable"), { code: "P2021" });
      // Parse/permission-check critical runtime relations and columns without
      // reading any account, order, ledger, contact or subscription records.
      await database!.$queryRaw`SELECT "sessionVersion"::text AS probe FROM "User" WHERE false
        UNION ALL SELECT "catalogVersion"::text FROM "Product" WHERE false
        UNION ALL SELECT "refundVersion"::text FROM "Order" WHERE false
        UNION ALL SELECT id FROM "CartLine" WHERE false
        UNION ALL SELECT "codeHash" FROM "OtpToken" WHERE false
        UNION ALL SELECT "deltaCents"::text FROM "SellerLedgerEntry" WHERE false
        UNION ALL SELECT "readVersion"::text FROM "Notification" WHERE false
        UNION ALL SELECT version::text FROM "SupportMessage" WHERE false
        UNION ALL SELECT published::text FROM "SupportContactSettings" WHERE false
        UNION ALL SELECT generation::text FROM "NewsletterSubscriber" WHERE false
        UNION ALL SELECT "publishedVersion"::text FROM "SiteContent" WHERE false
        UNION ALL SELECT action::text FROM "SiteContentRevision" WHERE false LIMIT 0`;
      checks.database = true;
      } catch (error) { failed("database", error); }
    })(),
    (async () => { try { if ((await getRedisClient()?.ping()) !== "PONG") throw Object.assign(Error("Redis unavailable"), { code: "ECONNREFUSED" }); checks.redis = true; } catch (error) { failed("redis", error); } })(),
  ]);
  return { status: Object.values(checks).every(Boolean) ? "READY" : "UNAVAILABLE", checks, ...(Object.keys(references).length ? { references } : {}) };
}

/** One bounded probe per worker at a time, cached for five seconds. No host,
 * key, exception, SQL text or customer data appears in the public result. */
export async function getReadiness(): Promise<ReadinessResult> {
  if (cached && cached.expires > Date.now()) return cached.result;
  pending ??= probe().then((result) => { cached = { expires: Date.now() + 5000, result }; return result; }).finally(() => { pending = undefined; });
  return pending;
}
