import { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ProductGallery } from "@/components/shared/product-gallery";
import Link from "next/link";
import { ProductDetailActions } from "./_components/product-detail-actions";
import { formatCurrency } from "@/lib/formatter";
import { generateProductSchema, generateBreadcrumbSchema } from "@/lib/seo/schema";
import { serializeJsonLd } from "@/lib/seo/serialize-json-ld";
import { CompareButton } from "@/components/catalog/compare-button";
import { specificationsSchema } from "@/lib/validations/specifications";
import { RecordProductView } from "@/components/catalog/record-product-view";
import { getPublicProduct } from "@/lib/public-product";
import { productPath } from "@/lib/seo/urls";
import { createMetadata } from "@/lib/seo/metadata";
import { readPublicReviews } from "@/lib/reviews";
import { ProductReviews } from "@/components/reviews/product-reviews";
import { RatingSummary } from "@/components/reviews/rating-summary";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  let product;
  try { product = await getPublicProduct(slug); } catch { return { title: "Products unavailable | Amar Gadget", robots: { index: false, follow: false } }; }

  if (!product) return { title: "Product not found | Amar Gadget", robots: { index: false, follow: false } };
  const price = Number(product.discountPrice ?? product.price);
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(product.stock) || product.stock < 0) return { title: "Product unavailable | Amar Gadget", robots: { index: false, follow: false } };
  return createMetadata({ title: product.name, description: product.description || `View ${product.name} and current catalog availability.`, image: product.imageUrl ?? undefined, canonicalUrl: productPath(product.slug, product.id) });
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getPublicProduct(slug);

  if (!product) {
    notFound();
  }

  if (`/products/${encodeURIComponent(slug)}` !== productPath(product.slug, product.id)) permanentRedirect(productPath(product.slug, product.id));
  const numericPrice = Number(product.price);
  const numericDiscountPrice = product.discountPrice === null ? null : Number(product.discountPrice);
  const effectivePrice = numericDiscountPrice ?? numericPrice;
  const specifications = specificationsSchema.parse(product.specifications);
  let reviewPage = null;
  try { reviewPage = await readPublicReviews(product.id); } catch { /* Keep the real product usable and expose a retryable review error. */ }

  const jsonLd = generateProductSchema({
    id: product.id,
    slug: product.slug,
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(generateBreadcrumbSchema([{ name: "Home", url: "/" }, { name: "Products", url: "/products" }, { name: product.name, url: productPath(product.slug, product.id) }])) }} />
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
                    {reviewPage ? <RatingSummary rating={reviewPage.rating} count={reviewPage.total} /> : <span>Ratings temporarily unavailable</span>}
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
          <ProductReviews key={product.id} productId={product.id} initialPage={reviewPage} />
        </div>
      </main>
    </>
  );
}
