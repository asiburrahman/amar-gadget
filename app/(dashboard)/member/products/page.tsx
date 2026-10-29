import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserWithRole } from "@/lib/session";
import { campaignPageSchema } from "@/lib/validations/campaign";
export const dynamic = "force-dynamic";
export default async function MemberProductsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getCurrentUserWithRole(["MEMBER", "ADMIN"]); if (!actor) redirect("/login");
  if (actor.role.toUpperCase() === "MEMBER" && actor.sellerStatus !== "APPROVED") return <main className="p-6"><h1>Seller account status</h1><p>Image management is available after approval.</p></main>;
  const parsed = campaignPageSchema.safeParse((searchParams ? await searchParams : {}).page);
  if (!parsed.success) return <main className="p-6"><p role="alert">Invalid page. <Link href="/member/products">Reset page</Link></p></main>;
  const page = parsed.data, limit = 12;
  const result = await prisma.$transaction(async (tx) => {
    const where = { sellerId: actor.id }; const total = await tx.product.count({ where });
    const products = page > Math.max(1, Math.ceil(total / limit)) ? [] : await tx.product.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit, skip: (page - 1) * limit, select: { id: true, name: true, status: true } });
    return { total, products, totalPages: Math.ceil(total / limit) };
  }, { isolationLevel: "RepeatableRead", timeout: 10_000 });
  return <main className="max-w-5xl mx-auto p-6 space-y-4"><h1 className="text-2xl font-bold">Your product images</h1><p>{result.total} products</p><Link href="/member/add-product">Add product</Link>
    <ul className="divide-y">{result.products.map((product) => <li key={product.id} className="py-4 flex flex-wrap gap-4"><span>{product.name} — {product.status}</span><Link href={`/member/products/${product.id}/images`} className="underline">Manage images for {product.name}</Link></li>)}</ul>
    {!result.products.length && <p>No products on this page. <Link href="/member/products">Return to first page</Link></p>}
    <nav aria-label="Your product pages" className="flex gap-4">{page > 1 && <Link href={`/member/products?page=${page - 1}`}>Previous products</Link>}{page < result.totalPages && <Link href={`/member/products?page=${page + 1}`}>Next products</Link>}</nav>
  </main>;
}
