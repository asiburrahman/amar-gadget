import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Fallback connection string
const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_XcFmCt0vhko4@ep-blue-frog-atpqk11x-pooler.c-9.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

const createPrismaClient = () => {
  try {
    const adapter = new PrismaNeonHttp(databaseUrl, {});
    return new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "warn", "error"]
          : ["error"],
    });
  } catch (error) {
    console.error("PrismaNeonHttp initialization fallback:", error);
    return new PrismaClient({
      log: ["error"],
    });
  }
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

