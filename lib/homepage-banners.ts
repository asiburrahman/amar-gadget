import { prisma } from "@/lib/prisma";
import { isPublicProductImageUrl } from "@/lib/product-media-policy";
import { isBannerLink, bannerPlacementSchema } from "@/lib/validations/banner";
export const MAX_ACTIVE_BANNERS_PER_PLACEMENT = 24;
export type HomepageBanner = { id: string; title: string; subtitle: string | null; imageUrl: string; linkUrl: string | null; placement: string; position: number };
export async function getHomepageBanners() {
  const rows = await prisma.banner.findMany({ where: { isActive: true }, select: { id: true, title: true, subtitle: true, imageUrl: true, linkUrl: true, placement: true, position: true }, orderBy: [{ position: "asc" }, { id: "asc" }], take: MAX_ACTIVE_BANNERS_PER_PLACEMENT * 3 + 1 });
  const result: Record<"HERO" | "PROMO" | "AD", HomepageBanner[]> = { HERO: [], PROMO: [], AD: [] };
  for (const row of rows) {
    const placement = bannerPlacementSchema.parse(row.placement);
    if (!isPublicProductImageUrl(row.imageUrl) || (row.linkUrl !== null && !isBannerLink(row.linkUrl))) throw new Error("An active banner requires operator review");
    result[placement].push(row);
    if (result[placement].length > MAX_ACTIVE_BANNERS_PER_PLACEMENT) throw new Error("Active banner capacity requires operator review");
  }
  return result;
}
