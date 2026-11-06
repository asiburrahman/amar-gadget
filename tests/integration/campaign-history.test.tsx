jest.mock("@/lib/session", () => ({ getCurrentUserWithRole: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn(() => "192.0.2.1"), rateLimit: jest.fn().mockResolvedValue({ success: true }) }));
import { randomUUID } from "node:crypto";
import type { PrismaClient, Product, User } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { getCurrentUserWithRole } from "@/lib/session";
import { getActiveCampaigns } from "@/lib/campaigns";
import { saveCampaign, deleteCampaign, listAdminCampaigns } from "@/server/actions/admin/campaign-actions";
import { getRecentProducts } from "@/lib/recent-products";
import { GET } from "@/app/api/products/recently-viewed/route";
import DealsPage from "@/app/(marketing)/deals/page";
import { rateLimit } from "@/lib/rate-limit";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("real SQL campaign windows, moderation, counts, mutation and view hydration", () => {
  let db: PrismaClient, seller: User, admin: User, blocked: User, campaignId: string;
  const products: Product[] = [], prefix = `audit-campaign-${randomUUID()}`;
  const fields = () => ({ title: prefix, slug: prefix, description: "Existing catalog discounts", startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), isActive: true, productIds: products.map((p) => p.id) });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    seller = await db.user.create({ data: { email: `${prefix}@example.invalid`, role: "MEMBER", isVerified: true } });
    blocked = await db.user.create({ data: { email: `${prefix}-blocked@example.invalid`, role: "MEMBER", sellerStatus: "BLOCKED", isVerified: true } });
    admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: "ADMIN", isVerified: true } });
    const category = await db.category.create({ data: { name: prefix, slug: prefix } });
    for (const suffix of ["live", "pending", "blocked", "no-discount", "no-stock"]) products.push(await db.product.create({ data: { name: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`, price: 100, discountPrice: suffix === "no-discount" ? null : 90, stock: suffix === "no-stock" ? 0 : 5, status: suffix === "pending" ? "PENDING_APPROVAL" : "APPROVED", sellerId: suffix === "blocked" ? blocked.id : seller.id, categoryId: category.id } }));
  });
  beforeEach(() => { (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); (rateLimit as jest.Mock).mockResolvedValue({ success: true }); });
  afterAll(async () => { if (db) try { await db.campaign.deleteMany({ where: { slug: { startsWith: prefix } } }); await db.product.deleteMany({ where: { slug: { startsWith: prefix } } }); await db.user.deleteMany({ where: { email: { startsWith: prefix } } }); await db.category.deleteMany({ where: { slug: prefix } }); } finally { await db.$disconnect(); } });
  it("creates a real campaign, lists only eligible sale stock and renders real product destinations", async () => {
    const created = await saveCampaign({ fields: fields() }); expect(created.success).toBe(true); if (!created.success) throw new Error(created.error); campaignId = created.data.id;
    const result = await getActiveCampaigns(); const campaign = result.campaigns.find((item) => item.id === campaignId)!;
    expect(campaign.products.map((item) => item.id)).toEqual([products[0].id]); expect(campaign.products[0].discountPrice).toBe(90);
    expect(Math.abs(Date.parse(result.now) - Date.now())).toBeLessThan(5000);
    expect(Date.parse(campaign.endsAt) - Date.now()).toBeGreaterThan(3500_000);
    expect(Date.parse(campaign.endsAt) - Date.now()).toBeLessThanOrEqual(3600_000);
    const html = renderToStaticMarkup(await DealsPage({})); expect(html).toContain(`/products/${products[0].slug}`); expect(html).not.toContain(products[1].name); expect(html).not.toContain("42/50");
    expect(html).toContain("Current catalog prices in BDT"); expect(html).not.toContain("Claim Deal Now");
  });
  it("keeps start inclusive/end exclusive, disables current listings and preserves independent catalog prices", async () => {
    for (const data of [{ startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 7200_000) }, { startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 1) }, { startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 3600_000), isActive: false }]) {
      await db.campaign.update({ where: { id: campaignId }, data }); expect((await getActiveCampaigns()).campaigns.some((item) => item.id === campaignId)).toBe(false);
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).discountPrice?.toString()).toBe("90");
    await db.campaign.update({ where: { id: campaignId }, data: { startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 3600_000), isActive: true } });
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "BLOCKED" } }); expect((await getActiveCampaigns()).campaigns.some((item) => item.id === campaignId)).toBe(false);
    await db.user.update({ where: { id: seller.id }, data: { sellerStatus: "APPROVED" } });
  });
  it("updates membership atomically, rejects stale edits/deletes and blocks a revoked admin", async () => {
    expect((await saveCampaign({ id: campaignId, version: 1, fields: { ...fields(), title: `${prefix} updated`, productIds: [products[0].id] } })).success).toBe(true);
    expect((await saveCampaign({ id: campaignId, version: 1, fields: fields() })).success).toBe(false); expect((await deleteCampaign({ id: campaignId, version: 1 })).success).toBe(false);
    expect(await db.campaignProduct.count({ where: { campaignId } })).toBe(1);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(null); expect((await saveCampaign({ fields: fields() })).success).toBe(false); expect((await listAdminCampaigns()).success).toBe(false);
    (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin); await db.user.update({ where: { id: admin.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await deleteCampaign({ id: campaignId, version: 2 })).success).toBe(false);
    admin = await db.user.findUniqueOrThrow({ where: { id: admin.id } }); (getCurrentUserWithRole as jest.Mock).mockResolvedValue(admin);
    expect((await listAdminCampaigns()).success).toBe(true); expect((await listAdminCampaigns("1.5")).success).toBe(false);
  });
  it("rejects missing products, invalid direct SQL windows and conflicting slugs without partial changes", async () => {
    expect((await saveCampaign({ fields: { ...fields(), productIds: ["missing"] } })).success).toBe(false);
    expect((await saveCampaign({ fields: fields() })).success).toBe(false);
    await expect(db.$executeRaw`UPDATE "Campaign" SET "endsAt" = "startsAt" WHERE id = ${campaignId}`).rejects.toBeDefined();
    expect(await db.campaign.count({ where: { slug: prefix } })).toBe(1);
  });
  it("hydrates only requested public history in view order, using refreshed price/stock", async () => {
    const ids = [products[3].id, products[0].id, products[1].id, products[2].id];
    await db.product.update({ where: { id: products[0].id }, data: { discountPrice: 80, stock: 2 } });
    const rows = await getRecentProducts(ids); expect(rows.map((item) => item.id)).toEqual([products[3].id, products[0].id]); expect(rows[1]).toMatchObject({ discountPrice: 80, stock: 2 });
    const params = new URLSearchParams(); for (const id of ids) params.append("product", id);
    const response = await GET(new Request(`http://localhost/api/products/recently-viewed?${params}`)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect((await response.json()).products.map((p: { id: string }) => p.id)).toEqual(rows.map((p) => p.id));
    expect((await GET(new Request(`http://localhost/api/products/recently-viewed?product=${ids[0]}&product=${ids[0]}`))).status).toBe(400);
    (rateLimit as jest.Mock).mockResolvedValue({ success: false }); expect((await GET(new Request("http://localhost/api/products/recently-viewed?product=one"))).status).toBe(429);
  });
  it("paginates campaigns with exact counts and avoids broadening invalid or distant pages", async () => {
    for (let index = 0; index < 7; index++) await db.campaign.create({ data: { title: `${prefix} page ${index}`, slug: `${prefix}-page-${index}`, startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 7200_000), isActive: true, products: { create: { productId: products[0].id, position: 0 } } } });
    const first = await getActiveCampaigns(1), second = await getActiveCampaigns(2);
    expect(first.total).toBe(8); expect(first.campaigns).toHaveLength(6); expect(second.campaigns).toHaveLength(2);
    expect(first.campaigns.some((item) => second.campaigns.some((other) => other.id === item.id))).toBe(false);
    expect((await getActiveCampaigns(1_000_000)).campaigns).toEqual([]);
    await expect(getActiveCampaigns(["1", "2"])).rejects.toBeDefined();
    await db.campaign.deleteMany({ where: { slug: { startsWith: `${prefix}-page-` } } });
  });
  it("deletes the campaign with its memberships without deleting products", async () => {
    expect((await deleteCampaign({ id: campaignId, version: 2 })).success).toBe(true); expect(await db.campaignProduct.count({ where: { campaignId } })).toBe(0); expect(await db.product.count({ where: { id: { in: products.map((p) => p.id) } } })).toBe(5);
  });
});
