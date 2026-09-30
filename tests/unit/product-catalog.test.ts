import { findFallbackProduct, FALLBACK_PRODUCTS } from "../../lib/mock-catalog";

describe("Product Catalog & Fallback System", () => {
  it("has a valid fallback catalog with required fields", () => {
    expect(FALLBACK_PRODUCTS.length).toBeGreaterThan(15);
    FALLBACK_PRODUCTS.forEach((product) => {
      expect(product.id).toBeDefined();
      expect(product.slug).toBeDefined();
      expect(product.name).toBeDefined();
      expect(product.price).toBeGreaterThan(0);
      expect(product.category.name).toBeDefined();
      expect(product.imageUrl).toBeDefined();
    });
  });

  it("finds products by exact ID", () => {
    const p1 = findFallbackProduct("prod-1");
    expect(p1).not.toBeNull();
    expect(p1?.name).toContain("Wireless Audio Speakers");

    const pSpecial = findFallbackProduct("special-xbox-controller");
    expect(pSpecial).not.toBeNull();
    expect(pSpecial?.name).toContain("Game Console Wireless Controller");
  });

  it("finds products by slug or prefix", () => {
    const watch = findFallbackProduct("smartwatch-s3");
    expect(watch).not.toBeNull();
    expect(watch?.name).toContain("Gear S3");

    const bw1 = findFallbackProduct("bw-1");
    expect(bw1).not.toBeNull();
    expect(bw1?.name).toContain("Purple Wireless");
  });

  it("handles case-insensitive search", () => {
    const p2 = findFallbackProduct("PROD-2");
    expect(p2).not.toBeNull();
    expect(p2?.id).toBe("prod-2");
  });
});
