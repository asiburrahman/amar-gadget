import { notFound, permanentRedirect, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveCatalogCategory } from "@/lib/catalog-category-filter";
import { createMetadata } from "@/lib/seo/metadata";
import ProductsPage from "../../products/page";
import { categoryPath } from "@/lib/seo/urls";
type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: Props) {
  try {
    const result = await resolveCatalogCategory((await params).slug, undefined);
    return result.state === "found" ? createMetadata({ title: `${result.category.name} collection`, description: `Browse current ${result.category.name} products.`, canonicalUrl: categoryPath(result.category) }) : { title: "Category not found | Amar Gadget", robots: { index: false, follow: false } };
  } catch { return { title: "Category unavailable | Amar Gadget", robots: { index: false, follow: false } }; }
}
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params; const result = await resolveCatalogCategory(slug, undefined);
  if (result.state !== "found") notFound();
  if (`/categories/${encodeURIComponent(slug)}` !== categoryPath(result.category)) {
    const aliases = await prisma.$queryRaw<{ id: string }[]>`SELECT "categoryId" AS id FROM "CategoryAlias" WHERE lower(slug)=lower(${slug}) AND "categoryId"=${result.category.id} LIMIT 1`;
    // Slugs can be restored. A cached permanent A -> B and later B -> A
    // redirect would loop, so retained editable URLs use a temporary redirect.
    if (aliases.length) redirect(categoryPath(result.category));
    permanentRedirect(categoryPath(result.category));
  }
  return <ProductsPage searchParams={Promise.resolve({ categoryId: result.category.id })} />;
}
