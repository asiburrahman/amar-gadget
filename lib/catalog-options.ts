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
    if (kind === "category") {
      const tree = Prisma.sql`WITH RECURSIVE tree AS (SELECT id,name,slug,"parentId",name::text AS label FROM "Category" WHERE "parentId" IS NULL UNION ALL SELECT c.id,c.name,c.slug,c."parentId",t.label||' / '||c.name FROM "Category" c JOIN tree t ON c."parentId"=t.id)`;
      const filter = search ? Prisma.sql`WHERE label ILIKE ${pattern} OR slug ILIKE ${pattern}` : Prisma.empty;
      const [row] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`${tree} SELECT count(*)::bigint AS total FROM tree ${filter}`);
      const total = Number(row.total), limit = 25;
      if (!Number.isSafeInteger(total)) throw new Error("Category option count exceeds supported range");
      const items = (page - 1) * limit >= total ? [] : await tx.$queryRaw<CatalogOption[]>(Prisma.sql`${tree} SELECT id,label AS name,slug FROM tree ${filter} ORDER BY label,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    }
    const counts = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM ${table} ${where}`;
    const total = Number(counts[0].total), limit = 25;
    const items = (page - 1) * limit >= total ? [] : await tx.$queryRaw<CatalogOption[]>`SELECT id, name, slug FROM ${table} ${where} ORDER BY name, id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
}
export type CatalogOptions = Awaited<ReturnType<typeof getCatalogOptions>>;
