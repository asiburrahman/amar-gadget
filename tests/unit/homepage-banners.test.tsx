/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BannerCarousel } from "@/components/home/banner-carousel";
import { PromoBanners } from "@/components/home/promo-banners";
import { BannerAd } from "@/components/home/banner-ad";
import { HeroSection } from "@/components/home/hero-section";
import { isBannerLink, bannerFieldsSchema } from "@/lib/validations/banner";
const banner = { id: "one", title: "Saved first offer", subtitle: "A current description", imageUrl: "/images/banner.png", linkUrl: "/products?category=phones", placement: "HERO", position: 1 };
it.each(["javascript:alert(1)", "https://outside.example/", "//outside.example", "/%2foutside.example", "/products\\outside", "/products%0afoo", "/admin", "/products/../../api/upload", "/..//outside.example", "/bad%escape"])("rejects unsafe or non-storefront link %s", (value) => { expect(isBannerLink(value)).toBe(false); });
it.each(["/", "/products", "/products?search=usb%20c", "/categories/phones#items", "/deals/summer"])("accepts storefront link %s", (value) => { expect(isBannerLink(value)).toBe(true); });
it("validates plain text, ordering bounds and nullable link/subtitle without accepting a client image URL", () => {
  const fields = { title: " Saved title ", subtitle: null, linkUrl: null, placement: "PROMO", position: 2, isActive: true };
  expect(bannerFieldsSchema.parse(fields).title).toBe("Saved title");
  for (const change of [{ title: "\n" }, { title: "hidden\u0000value" }, { position: -1 }, { position: 1.1 }, { imageUrl: "https://foreign.example/image.png" }]) expect(bannerFieldsSchema.safeParse({ ...fields, ...change }).success).toBe(false);
});
it("provides working labelled previous/next and direct slide controls without fake timer state", () => {
  render(<BannerCarousel banners={[banner, { ...banner, id: "two", title: "Saved second offer", linkUrl: null }]} />);
  expect(screen.getByRole("heading", { name: banner.title })).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Next featured offer" })); expect(screen.getByRole("heading", { name: "Saved second offer" })).toBeTruthy(); expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Previous featured offer" })); expect(screen.getByRole("link").getAttribute("href")).toBe(banner.linkUrl);
  fireEvent.click(screen.getByRole("button", { name: /Show featured offer 2/ })); expect(screen.getByRole("button", { name: /Show featured offer 2/ }).getAttribute("aria-current")).toBe("true");
});
it("uses active managed placement content instead of fallbacks and keeps unlinked announcements unlinked", () => {
  render(<><HeroSection banners={[banner]} /><PromoBanners banners={[{ ...banner, id: "promo", title: "Saved promo" }]} /><BannerAd banners={[{ ...banner, id: "ad", title: "Saved announcement", linkUrl: null }]} /></>);
  expect(screen.getByRole("heading", { name: banner.title })).toBeTruthy(); expect(screen.queryByText("THE NEW")).toBeNull(); expect(screen.queryByText("Explore the catalog")).toBeNull(); expect(screen.queryByText("Find your next gadget")).toBeNull(); expect(within(screen.getByRole("region", { name: "Store announcements" })).queryByRole("link")).toBeNull();
});
it("shows generic fallbacks only for empty placements and preserves explicit unavailable states", () => {
  const view = render(<><PromoBanners /><BannerAd /><HeroSection /></>); expect(screen.getByText("Explore the catalog")).toBeTruthy(); expect(screen.getByText("Find your next gadget")).toBeTruthy(); expect(screen.queryByText(/79.99|1-year/)).toBeNull();
  view.rerender(<><PromoBanners unavailable /><BannerAd unavailable /><HeroSection unavailable /></>); expect(screen.getAllByRole("alert")).toHaveLength(3); expect(screen.queryByText("Explore the catalog")).toBeNull(); expect(screen.queryByText("Find your next gadget")).toBeNull(); expect(screen.queryByText("THE NEW")).toBeNull();
});
