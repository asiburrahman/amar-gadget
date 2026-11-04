/** @jest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
jest.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: jest.fn() }, category: { findMany: jest.fn() }, brand: { findMany: jest.fn() } } }));
jest.mock("@/lib/catalog-listing", () => ({ getCatalogListing: jest.fn() }));
jest.mock("@/lib/campaigns", () => ({ getActiveCampaigns: jest.fn() }));
jest.mock("@/lib/homepage-banners", () => ({ getHomepageBanners: jest.fn() }));
jest.mock("@/components/shared/seo-guard", () => ({ SEOGuard: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/home/promo-banners", () => ({ PromoBanners: () => null }));
jest.mock("@/components/home/special-deal-section", () => ({ SpecialDealSection: () => null }));
jest.mock("@/components/home/best-sellers-section", () => ({ BestSellersSection: () => null }));
jest.mock("@/components/home/banner-ad", () => ({ BannerAd: () => null }));
jest.mock("@/components/home/recently-viewed", () => ({ RecentlyViewed: () => null }));
jest.mock("@/components/home/brand-logos", () => ({ BrandLogos: () => null }));
jest.mock("@/components/home/newsletter-bar", () => ({ NewsletterBar: () => null }));
jest.mock("@/components/footer/electro-footer", () => ({ ElectroFooter: () => null }));
import Home from "@/app/(marketing)/page";
import { prisma } from "@/lib/prisma";
import { getCatalogListing } from "@/lib/catalog-listing";
import { getActiveCampaigns } from "@/lib/campaigns";
import { getHomepageBanners } from "@/lib/homepage-banners";
import { serviceUnavailable } from "@/lib/observability";
beforeEach(() => {
  jest.clearAllMocks(); (prisma.product.findMany as jest.Mock).mockResolvedValue([]); (prisma.category.findMany as jest.Mock).mockResolvedValue([]); (prisma.brand.findMany as jest.Mock).mockResolvedValue([]);
  (getCatalogListing as jest.Mock).mockResolvedValue({ products: [] }); (getActiveCampaigns as jest.Mock).mockResolvedValue({ campaigns: [], now: new Date().toISOString() }); (getHomepageBanners as jest.Mock).mockResolvedValue({ HERO: [], PROMO: [], AD: [] });
});
it("keeps genuinely empty sections separate from unavailable sections and emits no false incident", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try { render(await Home()); expect(screen.queryByText("Some homepage sections are temporarily unavailable")).toBeNull(); expect(screen.getAllByText("No products available")).toHaveLength(3); expect(log).not.toHaveBeenCalled(); }
  finally { log.mockRestore(); }
});
it("keeps healthy sections usable and gives a failed category preview a visible retry/reference", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    (prisma.category.findMany as jest.Mock).mockRejectedValue(Object.assign(new Error("private SQL password"), { code: "P1001" }));
    render(await Home()); expect(screen.getByRole("link", { name: "Reload categories" }).getAttribute("href")).toBe("/categories");
    const reference = JSON.parse(log.mock.calls[0][0]).reference; expect(screen.getByText(`Category navigation: reference ${reference}`)).toBeTruthy(); expect(screen.queryByText(/private SQL/)).toBeNull();
    expect(screen.getByRole("link", { name: "Reload homepage sections" })).toBeTruthy(); expect(screen.getAllByText("No products available")).toHaveLength(3); expect(log).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});
it("does not turn failed featured products into a healthy empty footer and reuses an existing incident", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const failure = serviceUnavailable("catalog.featured", Error("private provider payload")); (prisma.product.findMany as jest.Mock).mockRejectedValue(failure);
    render(await Home()); expect(log).toHaveBeenCalledTimes(1); expect(screen.getByText(`Featured products: reference ${failure.digest}`)).toBeTruthy();
    expect(screen.getByText(/Featured Products are temporarily unavailable/)).toBeTruthy(); expect(screen.getAllByText("No products available")).toHaveLength(2); expect(screen.queryByText(/private provider/)).toBeNull();
  } finally { log.mockRestore(); }
});
it("reports all independently failed product sections without dumping their raw causes", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    (getCatalogListing as jest.Mock).mockRejectedValue(Object.assign(Error("customer private SQL"), { code: "P2021" }));
    render(await Home()); const summary = screen.getByRole("heading", { name: "Some homepage sections are temporarily unavailable" }).parentElement!;
    expect(within(summary).getAllByRole("listitem")).toHaveLength(3); expect(log).toHaveBeenCalledTimes(3); expect(screen.queryByText(/customer private SQL/)).toBeNull(); expect(screen.getAllByText("No products available")).toHaveLength(1);
  } finally { log.mockRestore(); }
});
