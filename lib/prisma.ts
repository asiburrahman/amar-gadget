import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readDatabaseConfig } from "@/config/runtime";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};


const createPrismaClient = () => {
  // Checkout, OTP and webhooks require interactive transactions. Use PostgreSQL
  // TCP (including Neon's pooled TCP URL); the Neon HTTP adapter rejects them.
  const adapter = new PrismaPg({
    connectionString: readDatabaseConfig().DATABASE_URL,
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
