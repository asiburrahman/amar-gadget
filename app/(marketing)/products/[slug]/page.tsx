import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import { ProductDetailActions } from "./_components/product-detail-actions";
import { formatCurrency } from "@/lib/formatter";
import { generateProductSchema } from "@/lib/seo/schema";

const getProduct = cache(async (identifier: string) => {
  let product = await prisma.product.findUnique({
    where: { slug: identifier },
    include: {
      category: true,
      brand: true,
      seller: { select: { id: true, name: true, email: true } },
      reviews: {
        include: { user: { select: { name: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!product) {
    product = await prisma.product.findUnique({
      where: { id: identifier },
      include: {
        category: true,
        brand: true,
        seller: { select: { id: true, name: true, email: true } },
        reviews: {
          include: { user: { select: { name: true, avatar: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  return product;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) return { title: "Product Not Found | Amar Gadget" };

  return {
    title: `${product.name} | Amar Gadget`,
    description: product.description || `Buy ${product.name} at best price in Bangladesh with official warranty.`,
    openGraph: {
      title: product.name,
      description: product.description || undefined,
      images: product.imageUrl ? [{ url: product.imageUrl }] : [],
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  const numericPrice = Number(product.price);
  const numericDiscountPrice = product.discountPrice ? Number(product.discountPrice) : null;
  const effectivePrice = numericDiscountPrice || numericPrice;

  const jsonLd = generateProductSchema({
    id: product.id,
    name: product.name,
    description: product.description || "",
    image: product.imageUrl || "",
    price: effectivePrice,
    stock: product.stock,
    categoryName: product.category?.name,
    brandName: product.brand?.name,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-background py-10">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Breadcrumb */}
          <div className="flex items-center text-xs text-muted-foreground mb-6 space-x-2">
            <a href="/" className="hover:text-primary">Home</a>
            <span>/</span>
            <a href="/products" className="hover:text-primary">Products</a>
            <span>/</span>
            {product.category && (
              <>
                <a href={`/products?categoryId=${product.category.id}`} className="hover:text-primary">
                  {product.category.name}
                </a>
                <span>/</span>
              </>
            )}
            <span className="text-foreground font-medium truncate max-w-xs">{product.name}</span>
          </div>

          {/* Product Header & Main Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 bg-card border border-border p-6 md:p-8 rounded-2xl shadow-sm">
            {/* Left: Product Image */}
            <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-muted/20 border border-border flex items-center justify-center">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  priority
                  className="object-contain p-4"
                />
              ) : (
                <div className="text-muted-foreground font-medium text-sm">No Image Available</div>
              )}
              {product.discountPrice && (
                <span className="absolute top-4 left-4 bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                  OFFER DEALS
                </span>
              )}
            </div>

            {/* Right: Product Details & Purchase Actions */}
            <div className="flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                {product.brand && (
                  <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-1 rounded-md">
                    {product.brand.name}
                  </span>
                )}
                
                <h1 className="text-2xl md:text-3xl font-extrabold text-foreground leading-snug">
                  {product.name}
                </h1>

                {/* Rating & Stock */}
                <div className="flex items-center space-x-4 text-xs">
                  <div className="flex items-center text-amber-500 font-semibold">
                    {"★".repeat(Math.round(product.rating || 5))}
                    <span className="ml-1 text-muted-foreground font-normal">
                      ({product.reviewCount || 0} reviews)
                    </span>
                  </div>
                  <span className="text-border">|</span>
                  <span className={product.stock > 0 ? "text-emerald-600 font-bold bg-emerald-500/10 px-2 py-0.5 rounded" : "text-destructive font-bold"}>
                    {product.stock > 0 ? `In Stock (${product.stock} units)` : "Out of Stock"}
                  </span>
                </div>

                {/* Pricing */}
                <div className="flex items-baseline space-x-3 pt-2">
                  <span className="text-3xl font-extrabold text-foreground">
                    {formatCurrency(effectivePrice)}
                  </span>
                  {numericDiscountPrice && (
                    <span className="text-lg text-muted-foreground line-through">
                      {formatCurrency(numericPrice)}
                    </span>
                  )}
                </div>

                {/* Seller Info */}
                <div className="p-3.5 rounded-xl bg-muted/40 border border-border flex items-center justify-between text-xs">
                  <div>
                    <span className="text-muted-foreground">Sold & Verified by:</span>
                    <p className="font-bold text-foreground text-sm">{product.seller?.name || "Official Amar Gadget Vendor"}</p>
                  </div>
                  <span className="bg-primary/10 text-primary font-semibold px-2.5 py-1 rounded">Official Partner</span>
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {product.description || "Authentic tech product sourced directly with official manufacturer warranty and fast express shipping across Bangladesh."}
                </p>
              </div>

              {/* Client Action Component */}
              <ProductDetailActions
                product={{
                  id: product.id,
                  name: product.name,
                  price: numericPrice,
                  discountPrice: numericDiscountPrice,
                  imageUrl: product.imageUrl,
                  stock: product.stock,
                  category: product.category?.name,
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}