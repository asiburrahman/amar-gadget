import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignPageSchema } from "@/lib/validations/campaign";

type Row = { id: string; title: string; slug: string; description: string; startsAt: string; endsAt: string; products: { id: string; slug: string; name: string; price: number; discountPrice: number; stock: number; imageUrl: string | null; rating: number; category: string }[] };
// Campaigns curate existing catalog offers; they never override checkout prices.
export async function getActiveCampaigns(pageInput: unknown = 1) {
  const page = campaignPageSchema.parse(pageInput), limit = 6;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`;
    // Use a single SQL clock for eligibility, count and rows within this request.
    const [{ epoch }] = await tx.$queryRaw<{ epoch: number }[]>`SELECT EXTRACT(epoch FROM CURRENT_TIMESTAMP)::double precision AS epoch`;
    const now = new Date(epoch * 1000).toISOString();
    const eligible = Prisma.sql`FROM "CampaignProduct" cp JOIN "Product" p ON p.id = cp."productId" JOIN "User" u ON u.id = p."sellerId" JOIN "Category" cat ON cat.id = p."categoryId" WHERE cp."campaignId" = c.id AND p.status = 'APPROVED' AND u."sellerStatus" = 'APPROVED' AND p.stock > 0 AND p."discountPrice" > 0 AND p."discountPrice" < p.price`;
    const where = Prisma.sql`WHERE c."isActive" = true AND c."startsAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND c."endsAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND EXISTS (SELECT 1 ${eligible})`;
    const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "Campaign" c ${where}`;
    const total = Number(count), totalPages = Math.ceil(total / limit);
    if (page > Math.max(1, totalPages)) return { campaigns: [], page, total, totalPages, now };
    const rows = await tx.$queryRaw<Row[]>`SELECT c.id, c.title, c.slug, c.description, to_char(c."startsAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startsAt", to_char(c."endsAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "endsAt", COALESCE((SELECT json_agg(items ORDER BY items.position) FROM (SELECT p.id, p.slug, p.name, p.price::double precision, p."discountPrice"::double precision, p.stock, p."imageUrl", p.rating, cat.name AS category, cp.position ${eligible} ORDER BY cp.position LIMIT 50) items), '[]') AS products FROM "Campaign" c ${where} ORDER BY c."endsAt", c.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    return { campaigns: rows, page, total, totalPages, now };
  }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
}
export type ActiveCampaign = Awaited<ReturnType<typeof getActiveCampaigns>>["campaigns"][number];
