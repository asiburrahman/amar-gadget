"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { withCurrentAdmin, CatalogMutationError } from "@/lib/catalog-mutations";
import { campaignSaveSchema, campaignDeleteSchema, campaignPageSchema } from "@/lib/validations/campaign";

function failure(error: unknown) {
  if (error instanceof CatalogMutationError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "This campaign slug is already used.";
  return "Campaign service is unavailable. Try again.";
}
function refresh() { for (const path of ["/", "/deals", "/admin/campaigns"]) revalidatePath(path); }
export async function saveCampaign(input: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) return { success: false as const, error: "Unauthorized" };
  const parsed = campaignSaveSchema.safeParse(input); if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the campaign." };
  try {
    const saved = await withCurrentAdmin(actor, async (tx) => {
      const { id, version, fields } = parsed.data;
      if (id) {
        await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.campaign.findUnique({ where: { id } });
        if (!current || current.version !== version) throw new CatalogMutationError("Campaign changed. Reload before saving.");
      }
      const products = await tx.product.findMany({ where: { id: { in: fields.productIds } }, select: { id: true, status: true, stock: true, price: true, discountPrice: true, seller: { select: { sellerStatus: true } } } });
      if (products.length !== fields.productIds.length) throw new CatalogMutationError("A selected product no longer exists. Reload the choices.");
      if (fields.isActive && !products.some((p) => p.status === "APPROVED" && p.seller.sellerStatus === "APPROVED" && p.stock > 0 && p.discountPrice !== null && p.discountPrice.gt(0) && p.discountPrice.lt(p.price))) throw new CatalogMutationError("An enabled campaign needs an approved, in-stock product with a valid current discount.");
      const data = { title: fields.title, slug: fields.slug, description: fields.description, startsAt: new Date(fields.startsAt), endsAt: new Date(fields.endsAt), isActive: fields.isActive };
      const row = id ? await tx.campaign.update({ where: { id }, data: { ...data, version: { increment: 1 } } }) : await tx.campaign.create({ data });
      if (id) await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
      if (fields.productIds.length) await tx.campaignProduct.createMany({ data: fields.productIds.map((productId, position) => ({ campaignId: row.id, productId, position })) });
      return { id: row.id, version: row.version };
    });
    refresh(); return { success: true as const, data: saved };
  } catch (error) { return { success: false as const, error: failure(error) }; }
}
export async function deleteCampaign(input: unknown) {
  const actor = await getCurrentUserWithRole(["ADMIN"]); if (!actor) return { success: false, error: "Unauthorized" };
  const parsed = campaignDeleteSchema.safeParse(input); if (!parsed.success) return { success: false, error: "Invalid campaign." };
  try {
    await withCurrentAdmin(actor, async (tx) => {
      const deleted = await tx.campaign.deleteMany({ where: { id: parsed.data.id, version: parsed.data.version } });
      if (deleted.count !== 1) throw new CatalogMutationError("Campaign changed. Reload before deleting.");
    }); refresh(); return { success: true };
  } catch (error) { return { success: false, error: failure(error) }; }
}
export async function listAdminCampaigns(pageInput: unknown = 1) {
  if (!(await getCurrentUserWithRole(["ADMIN"]))) return { success: false as const, error: "Unauthorized" };
  const parsed = campaignPageSchema.safeParse(pageInput); if (!parsed.success) return { success: false as const, error: "Invalid page." };
  try {
    const page = parsed.data, limit = 10;
    const result = await prisma.$transaction(async (tx) => {
      const total = await tx.campaign.count();
      const campaigns = page > Math.max(1, Math.ceil(total / limit)) ? [] : await tx.campaign.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, skip: (page - 1) * limit, include: { products: { orderBy: { position: "asc" }, take: 50, select: { product: { select: { id: true, name: true } } } } } });
      return { total, totalPages: Math.ceil(total / limit), page, campaigns: campaigns.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
    }, { isolationLevel: "RepeatableRead", timeout: 10_000 });
    return { success: true as const, ...result };
  } catch { return { success: false as const, error: "Campaign service is unavailable. Try again." }; }
}
