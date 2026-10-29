import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CatalogOption = { id: string; name: string; slug: string };
export async function getCatalogOptions(kind: "brand" | "category", search = "", page = 1) {
  if (!["brand", "category"].includes(kind) || search.length > 120 || !Number.isInteger(page) || page < 1 || page > 1_000_000) throw new Error("Invalid catalog option request");
  const table = kind === "brand" ? Prisma.sql`"Brand"` : Prisma.sql`"Category"`;
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const where = search ? Prisma.sql`WHERE name ILIKE ${pattern} OR slug ILIKE ${pattern}` : Prisma.empty;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
    const counts = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM ${table} ${where}`;
    const total = Number(counts[0].total), limit = 25;
    const items = (page - 1) * limit >= total ? [] : await tx.$queryRaw<CatalogOption[]>`SELECT id, name, slug FROM ${table} ${where} ORDER BY name, id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
}
export type CatalogOptions = Awaited<ReturnType<typeof getCatalogOptions>>;
