import { Metadata } from "next";
import { prisma } from "@/lib/prisma";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const product = await prisma.product.findUnique({
    where: { id: slug },
  });

  if (!product) return {};

  return {
    title: `${product.name} | Amar Gadget`,
    description: product.description || undefined,
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

  const product = await prisma.product.findUnique({
    where: { id: slug },
  });

  if (!product) {
    return (
      <div className="container mx-auto p-6 text-center text-red-500 font-semibold">
        Product not found
      </div>
    );
  }

  // Render structured schema data (JSON-LD) for search crawlers
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.imageUrl || undefined,
    description: product.description || undefined,
    offers: {
      "@type": "Offer",
      price: product.price.toString(),
      priceCurrency: "BDT",
      availability:
        product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="container mx-auto p-6">
        <h1 className="text-4xl font-bold font-sans">{product.name}</h1>
        {product.description && (
          <p className="mt-4 text-gray-700">{product.description}</p>
        )}
        <span className="text-2xl font-semibold mt-2 block">
          {product.price.toString()} BDT
        </span>
      </main>
    </>
  );
}