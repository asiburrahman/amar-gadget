import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { catalogIdSchema } from "@/lib/validations/product";
import { ProductGalleryEditor } from "@/components/catalog/product-gallery-editor";
export const dynamic = "force-dynamic";
export default async function ProductImagesPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUserWithRole(["MEMBER", "ADMIN"]); if (!actor) redirect("/login");
  if (actor.role.toUpperCase() === "MEMBER" && actor.sellerStatus !== "APPROVED") return <main className="p-6"><h1>Image management unavailable</h1><p>Seller approval is required.</p></main>;
  const parsed = catalogIdSchema.safeParse((await params).id); if (!parsed.success) notFound();
  const product = await prisma.product.findFirst({ where: { id: parsed.data, sellerId: actor.id }, select: { id: true, name: true, imageUrl: true, images: true, status: true, mediaVersion: true } });
  if (!product) notFound();
  const urls = [...new Set([...(product.imageUrl ? [product.imageUrl] : []), ...product.images])];
  return <main className="max-w-4xl mx-auto p-6 space-y-5"><h1 className="text-2xl font-bold">Images: {product.name}</h1><p>Product status: {product.status}</p><Link href="/member/products" className="underline">Back to your product images</Link><ProductGalleryEditor key={`${product.id}-${product.mediaVersion}`} productId={product.id} version={product.mediaVersion} urls={urls} /></main>;
}
