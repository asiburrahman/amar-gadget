import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serviceUnavailable } from "@/lib/observability";

export type CatalogOption = { id: string; name: string; slug: string; baseName?: string; image?: string | null; parentId?: string | null; logo?: string | null };
export async function getCatalogOptions(kind: "brand" | "category", search = "", page = 1) {
  if (!["brand", "category"].includes(kind) || search.length > 120 || /[\u0000-\u001f\u007f]/.test(search) || !Number.isInteger(page) || page < 1 || page > 1_000_000) throw new Error("Invalid catalog option request");
  const table = kind === "brand" ? Prisma.sql`"Brand"` : Prisma.sql`"Category"`;
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const where = search ? Prisma.sql`WHERE name ILIKE ${pattern} OR slug ILIKE ${pattern}` : Prisma.empty;
  try { return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    if (kind === "category") {
      const tree = Prisma.sql`WITH RECURSIVE tree AS (SELECT id,name,slug,image,"parentId",name::text AS label FROM "Category" WHERE "parentId" IS NULL UNION ALL SELECT c.id,c.name,c.slug,c.image,c."parentId",t.label||' / '||c.name FROM "Category" c JOIN tree t ON c."parentId"=t.id)`;
      const filter = search ? Prisma.sql`WHERE label ILIKE ${pattern} OR slug ILIKE ${pattern}` : Prisma.empty;
      const [row] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`${tree} SELECT count(*)::bigint AS total FROM tree ${filter}`);
      const total = Number(row.total), limit = 25;
      if (!Number.isSafeInteger(total)) throw new Error("Category option count exceeds supported range");
      const items = (page - 1) * limit >= total ? [] : await tx.$queryRaw<CatalogOption[]>(Prisma.sql`${tree} SELECT id,label AS name,name AS "baseName",slug,image,"parentId" FROM tree ${filter} ORDER BY label,id LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    }
    const counts = await tx.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM ${table} ${where}`;
    const total = Number(counts[0].total), limit = 25;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("Brand option count exceeds supported range");
    const items = (page - 1) * limit >= total ? [] : await tx.$queryRaw<CatalogOption[]>`SELECT id, name, slug,logo FROM ${table} ${where} ORDER BY name, id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 }); }
  catch (error) { throw serviceUnavailable(kind === "category" ? "taxonomy.categories" : "taxonomy.brands", error); }
}
export type CatalogOptions = Awaited<ReturnType<typeof getCatalogOptions>>;
export async function getCategoryOption(id: string): Promise<CatalogOption | null> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw Error("Invalid category identity");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout='4000ms'`; await tx.$executeRaw`SET LOCAL lock_timeout='1500ms'`;
      const rows = await tx.$queryRaw<CatalogOption[]>`WITH RECURSIVE ancestors AS (
        SELECT id,name,"parentId",ARRAY[id] AS visited,0 AS depth FROM "Category" WHERE id=${id}
        UNION ALL SELECT c.id,c.name,c."parentId",a.visited||c.id,a.depth+1 FROM "Category" c JOIN ancestors a ON c.id=a."parentId" WHERE NOT c.id=ANY(a.visited)
      ) SELECT c.id,c.name AS "baseName",c.slug,c.image,c."parentId",(SELECT string_agg(name,' / ' ORDER BY depth DESC) FROM ancestors) AS name FROM "Category" c WHERE c.id=${id} LIMIT 1`;
      return rows[0] ?? null;
    }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
  } catch (error) { throw serviceUnavailable("taxonomy.category", error); }
}
