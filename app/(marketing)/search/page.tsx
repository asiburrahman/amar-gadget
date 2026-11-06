import { redirect } from "next/navigation";
import ProductsPage from "../products/page";
import { catalogQuerySchema, catalogHref } from "@/lib/validations/catalog-query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search | Amar Gadget", robots: { index: false, follow: true } };
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const parsed = catalogQuerySchema.safeParse(input);
  if (parsed.success) redirect(catalogHref(parsed.data));
  return <ProductsPage searchParams={Promise.resolve(input)} />;
}
