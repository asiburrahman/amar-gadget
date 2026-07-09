import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Fallback dummy connection string for build-time static analysis
const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://db_owner:dummy_password@ep-dummy-pooler.c-9.us-east-1.aws.neon.tech/neondb";

// Instantiate the PrismaNeon adapter directly with the connection string config object
const adapter = new PrismaNeon({ connectionString: databaseUrl });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
