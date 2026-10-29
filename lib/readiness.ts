import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateRuntimeConfig } from "@/config/runtime";
import { getRedisClient } from "@/lib/redis";
import { REQUIRED_SCHEMA_MIGRATION } from "@/lib/database-schema";

let database: PrismaClient | undefined;
let cached: { expires: number; result: ReadinessResult } | undefined;
let pending: Promise<ReadinessResult> | undefined;
type ReadinessResult = { status: "READY" | "UNAVAILABLE"; checks: { configuration: boolean; database: boolean; redis: boolean } };

async function probe(): Promise<ReadinessResult> {
  const checks = { configuration: false, database: false, redis: false };
  try {
    const config = validateRuntimeConfig();
    checks.configuration = true;
    database ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL, max: 1, connectionTimeoutMillis: 1500, idleTimeoutMillis: 1000, query_timeout: 1500, statement_timeout: 1500, allowExitOnIdle: true }), log: [] });
  } catch { return { status: "UNAVAILABLE", checks }; }
  await Promise.allSettled([
    (async () => {
      const rows = await database!.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${REQUIRED_SCHEMA_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1`;
      checks.database = rows.length === 1;
    })(),
    (async () => { checks.redis = (await getRedisClient()?.ping()) === "PONG"; })(),
  ]);
  return { status: Object.values(checks).every(Boolean) ? "READY" : "UNAVAILABLE", checks };
}

/** One bounded probe per worker at a time, cached for five seconds. No host,
 * key, exception, SQL text or customer data appears in the public result. */
export async function getReadiness(): Promise<ReadinessResult> {
  if (cached && cached.expires > Date.now()) return cached.result;
  pending ??= probe().then((result) => { cached = { expires: Date.now() + 5000, result }; return result; }).finally(() => { pending = undefined; });
  return pending;
}
