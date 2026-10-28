import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getDatabaseUrl = () => {
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be configured before accessing the database.");
  }
  return databaseUrl;
};

const createPrismaClient = () => {
  // Checkout, OTP and webhooks require interactive transactions. Use PostgreSQL
  // TCP (including Neon's pooled TCP URL); the Neon HTTP adapter rejects them.
  const adapter = new PrismaPg({
    connectionString: getDatabaseUrl(),
    connectionTimeoutMillis: 10_000,
    max: 5,
  });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
