import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/shared/product-gallery";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { ProductDetailActions } from "./_components/product-detail-actions";
import { formatCurrency } from "@/lib/formatter";
import { generateProductSchema } from "@/lib/seo/schema";
import { serializeJsonLd } from "@/lib/seo/serialize-json-ld";
import { CompareButton } from "@/components/catalog/compare-button";
import { specificationsSchema } from "@/lib/validations/specifications";
import { RecordProductView } from "@/components/catalog/record-product-view";

export const dynamic = "force-dynamic";

const getProduct = cache(async (identifier: string) => {
  let product: Prisma.ProductGetPayload<{ include: { category: true; brand: true; seller: { select: { id: true; name: true; sellerStatus: true } }; reviews: { include: { user: { select: { name: true; avatar: true } } } } } }> | null = null;

  try {
    // 1. Try finding by slug
    product = await prisma.product.findUnique({
      where: { slug: identifier },
      include: {
        category: true,
        brand: true,
        seller: { select: { id: true, name: true, sellerStatus: true } },
        reviews: {
          include: { user: { select: { name: true, avatar: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // 2. If not found by slug, try by ID
    if (!product) {
      product = await prisma.product.findUnique({
        where: { id: identifier },
        include: {
          category: true,
          brand: true,
          seller: { select: { id: true, name: true, sellerStatus: true } },
          reviews: {
            include: { user: { select: { name: true, avatar: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }

    // 3. Fallback for case-insensitive slug variations
    if (!product) {
      product = await prisma.product.findFirst({
        where: {
          slug: { equals: identifier, mode: "insensitive" },
        },
        include: {
          category: true,
          brand: true,
          seller: { select: { id: true, name: true, sellerStatus: true } },
          reviews: {
            include: { user: { select: { name: true, avatar: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }
  } catch (error) {
    console.error("Database product lookup error:", identifier, error);
  }

  if (product && (product.status !== "APPROVED" || product.seller.sellerStatus !== "APPROVED")) {
    return null;
  }

  if (!product) return null;
  const { seller, ...publicProduct } = product;
  return {
    ...publicProduct,
    seller: { id: seller.id, name: seller.name },
  };
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
  const numericDiscountPrice = product.discountPrice === null ? null : Number(product.discountPrice);
  const effectivePrice = numericDiscountPrice ?? numericPrice;
  const specifications = specificationsSchema.parse(product.specifications);

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
      <RecordProductView productId={product.id} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <main className="min-h-screen bg-background py-10">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Breadcrumb */}
          <div className="flex items-center text-xs text-muted-foreground mb-6 space-x-2">
            <Link href="/" className="hover:text-primary">Home</Link>
            <span>/</span>
            <Link href="/products" className="hover:text-primary">Products</Link>
            <span>/</span>
            {product.category && (
              <>
                <Link href={`/products?categoryId=${product.category.id}`} className="hover:text-primary">
                  {product.category.name}
                </Link>
                <span>/</span>
              </>
            )}
            <span className="text-foreground font-medium truncate max-w-xs">{product.name}</span>
          </div>

          {/* Product Header & Main Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 bg-card border border-border p-6 md:p-8 rounded-2xl shadow-sm">
            {/* Left: Product Image */}
            <ProductGallery name={product.name} imageUrl={product.imageUrl} images={product.images} offer={Boolean(product.discountPrice)} />

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
              <CompareButton productId={product.id} name={product.name} />
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
          <section aria-label="Technical specifications" className="mt-8 border rounded-xl p-6"><h2 className="text-xl font-bold mb-4">Technical specifications</h2>
            {specifications.length ? <dl>{specifications.map((spec) => <div key={spec.label} className="grid sm:grid-cols-2 gap-2 border-b py-3"><dt className="font-semibold">{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl> : <p>No technical specifications supplied.</p>}
          </section>
        </div>
      </main>
    </>
  );
}
