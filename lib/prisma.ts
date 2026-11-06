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
    // Engine diagnostics can contain SQL parameters, sender text or provider
    // error details. Request owners emit their own redacted operational logs.
    // Do not enable automatic query/error output, including in development.
    log: [],
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
