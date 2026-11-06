import { createMetadata } from "@/lib/seo/metadata";
import { canonicalUrl, productPath, categoryPath, publicImageUrl } from "@/lib/seo/urls";
import { generateProductSchema, generateOrganizationSchema, generateWebsiteSchema } from "@/lib/seo/schema";
import { privateIndexPath } from "@/lib/seo/policy";

beforeEach(() => { process.env.APP_URL = "https://seo.example.invalid"; });
it("uses only current APP_URL for canonical, OG and schema origins, with no invented social/logo data", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://old.invalid"; process.env.VERCEL_URL = "old.invalid";
  const metadata = createMetadata({ title: "Phone", description: "Stored description", canonicalUrl: "/products/phone" });
  expect(metadata.alternates?.canonical).toBe("https://seo.example.invalid/products/phone");
  expect(metadata.openGraph).toMatchObject({ url: "https://seo.example.invalid/products/phone", title: "Phone | Amar Gadget" });
  expect(metadata.openGraph).not.toHaveProperty("images"); expect(metadata.twitter).not.toHaveProperty("creator");
  expect(generateOrganizationSchema()).not.toHaveProperty("contactPoint"); expect(generateOrganizationSchema()).not.toHaveProperty("logo");
  expect(generateWebsiteSchema().potentialAction.target).toBe("https://seo.example.invalid/search?q={search_term_string}");
  process.env.APP_URL = "https://another.example.invalid"; expect(canonicalUrl("/")).toBe("https://another.example.invalid/");
});
it("formats real relative/HTTPS media, omits unsafe media and prevents duplicate branding", () => {
  expect(publicImageUrl("/file.svg")).toBe("https://seo.example.invalid/file.svg"); expect(publicImageUrl("//cdn.example.invalid/image.png")).toBe("https://cdn.example.invalid/image.png");
  for (const image of ["javascript:alert(1)", "https://user:secret@example.invalid/x", "http://outside.invalid/x", ""]) expect(publicImageUrl(image)).toBeUndefined();
  expect(createMetadata({ title: "Phone | Amar Gadget", description: "Actual", image: "/file.svg" }).title).toBe("Phone | Amar Gadget");
});
it.each(["//evil.invalid", "https://evil.invalid", "/\\evil.invalid", "/products#private", "/products\nother"])("rejects an unsafe canonical destination %s", (path) => expect(() => canonicalUrl(path)).toThrow());
it("requires APP_URL instead of silently publishing a fallback domain", () => { delete process.env.APP_URL; expect(() => canonicalUrl("/")).toThrow("APP_URL"); });
it("encodes actual slugs and uses stable ID destinations for unusable legacy slugs", () => {
  expect(productPath("a & b")).toBe("/products/a%20%26%20b"); expect(productPath("..", "id")).toBe("/products/id"); expect(productPath("x".repeat(513), "id")).toBe("/products/id");
  expect(categoryPath({ slug: "", id: "category-id" })).toBe("/categories/category-id");
});
it.each([0, 1])("derives stock=%s availability and actual offer URL/currency/price without invented validity or brand", (stock) => {
  const schema = generateProductSchema({ id: "id", slug: "real-slug", name: "Real gadget", description: "Stored", stock, price: 90 });
  expect(schema.offers).toEqual({ "@type": "Offer", url: "https://seo.example.invalid/products/real-slug", priceCurrency: "BDT", price: 90, availability: `https://schema.org/${stock ? "InStock" : "OutOfStock"}` });
  expect(schema).not.toHaveProperty("brand"); expect(schema).not.toHaveProperty("image"); expect(schema.sku).toBe("id");
});
it.each(["/admin", "/member/orders", "/user/profile", "/api/products", "/checkout", "/order-success/id", "/cart", "/track-order", "/login", "/register", "/reset-password", "/wishlist", "/account", "/compare", "/search"])("marks personal/internal flow %s noindex", (path) => expect(privateIndexPath(path)).toBe(true));
it("keeps public product routes indexable and emits noindex metadata when requested", () => {
  expect(privateIndexPath("/products/private-case")).toBe(false);
  expect(createMetadata({ title: "Private", description: "Private", noIndex: true }).robots).toMatchObject({ index: false, follow: false });
});
