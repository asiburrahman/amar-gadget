import { createMetadata } from "../../lib/seo/metadata";

describe("SEO Metadata Factory (Phase 1)", () => {
  it("generates default metadata with title, description, and canonical URL", () => {
    const metadata = createMetadata({
      title: "iPhone 16 Pro Max",
      description: "Buy iPhone 15 Pro Max in Bangladesh",
      canonicalUrl: "/products/iphone-16-pro-max",
    });

    expect(metadata.title).toBe("iPhone 16 Pro Max | Amar Gadget");
    expect(metadata.description).toBe("Buy iPhone 15 Pro Max in Bangladesh");
    expect(metadata.alternates?.canonical).toContain("/products/iphone-16-pro-max");
    expect((metadata.openGraph as any)?.title).toBe("iPhone 16 Pro Max | Amar Gadget");
    expect((metadata.openGraph as any)?.type).toBe("website");
    expect((metadata.twitter as any)?.card).toBe("summary_large_image");
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    });
  });

  it("prevents duplicate brand suffixes if title already contains Amar Gadget", () => {
    const metadata = createMetadata({
      title: "Explore Flagship Phones | Amar Gadget",
      description: "Leading multi-vendor store",
    });

    expect(metadata.title).toBe("Explore Flagship Phones | Amar Gadget");
  });

  it("handles noIndex flag correctly for private or not found pages", () => {
    const metadata = createMetadata({
      title: "Product Not Found",
      description: "The requested product does not exist.",
      noIndex: true,
    });

    expect(metadata.title).toBe("Product Not Found | Amar Gadget");
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      googleBot: {
        index: false,
        follow: false,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    });
  });

  it("formats OpenGraph image URLs correctly for relative, protocol-relative, and absolute paths", () => {
    const metadataWithRelativeImage = createMetadata({
      title: "MacBook Air M3",
      description: "Apple MacBook Air M3",
      image: "/images/macbook.jpg",
    });

    const ogImages = (metadataWithRelativeImage.openGraph as any)?.images as any[];
    expect(ogImages[0].url).toContain("/images/macbook.jpg");

    const metadataWithAbsoluteImage = createMetadata({
      title: "MacBook Air M3",
      description: "Apple MacBook Air M3",
      image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8",
    });

    const absoluteOgImages = (metadataWithAbsoluteImage.openGraph as any)?.images as any[];
    expect(absoluteOgImages[0].url).toBe("https://images.unsplash.com/photo-1517336714731-489689fd1ca8");

    const metadataWithProtocolRelative = createMetadata({
      title: "MacBook Air M3",
      description: "Apple MacBook Air M3",
      image: "//cdn.example.com/macbook.jpg",
    });

    const protocolRelativeOgImages = (metadataWithProtocolRelative.openGraph as any)?.images as any[];
    expect(protocolRelativeOgImages[0].url).toBe("https://cdn.example.com/macbook.jpg");
  });
});
