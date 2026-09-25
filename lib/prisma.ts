import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getDatabaseUrl = () => {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    "postgresql://neondb_owner:npg_XcFmCt0vhko4@ep-blue-frog-atpqk11x-pooler.c-9.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  );
};

const createPrismaClient = () => {
  const dbUrl = getDatabaseUrl();
  try {
    const adapter = new PrismaNeonHttp(dbUrl, {});
    return new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "warn", "error"]
          : ["error"],
    });
  } catch (error) {
    console.error("PrismaNeonHttp adapter fallback to standard PrismaClient:", error);
    return new PrismaClient({
      log: ["error"],
    });
  }
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

