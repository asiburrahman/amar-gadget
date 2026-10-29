import Link from "next/link";
import { comparisonQuery } from "@/lib/validations/comparison";
import { getProductComparison } from "@/lib/product-comparison";
import { specificationKey } from "@/lib/validations/specifications";
import { ComparisonSelection } from "@/components/catalog/comparison-selection";
import { formatCurrency } from "@/lib/formatter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare products | Amar Gadget", robots: { index: false, follow: true } };
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parsed = comparisonQuery(await searchParams);
  if (!parsed.success) return <main className="container mx-auto p-6"><h1>Compare products</h1><p role="alert">Choose up to four distinct product IDs.</p><Link href="/compare">Reset comparison</Link></main>;
  let result: Awaited<ReturnType<typeof getProductComparison>>;
  try { result = await getProductComparison(parsed.data); }
  catch { return <main className="container mx-auto p-6"><h1>Compare products</h1><p role="alert">Comparison is temporarily unavailable. Reload to try again.</p><ComparisonSelection ids={parsed.data} /></main>; }
  const labels = new Map<string, string>(); for (const product of result.products) for (const spec of product.specifications) if (!labels.has(specificationKey(spec.label))) labels.set(specificationKey(spec.label), spec.label);
  const rows: { label: string; values: string[] }[] = [
    { label: "Current price (BDT)", values: result.products.map((product) => formatCurrency(product.discountPrice ?? product.price)) },
    { label: "Regular price (BDT)", values: result.products.map((product) => formatCurrency(product.price)) },
    { label: "Category", values: result.products.map((product) => product.category.name) },
    { label: "Brand", values: result.products.map((product) => product.brand?.name ?? "Not supplied") },
    { label: "Availability", values: result.products.map((product) => product.stock > 0 ? `In stock (${product.stock})` : "Out of stock") },
    ...[...labels].map(([key, label]) => ({ label, values: result.products.map((product) => product.specifications.find((spec) => specificationKey(spec.label) === key)?.value ?? "Not supplied") })),
  ];
  return <main className="container mx-auto max-w-7xl p-6 space-y-6"><h1 className="text-3xl font-bold">Compare products</h1><p>Compare up to four products. Prices and availability are refreshed from the catalog; technical details are supplied by the seller.</p>
    <ComparisonSelection ids={parsed.data} />
    {result.missing.length > 0 && <p role="status">{result.missing.length} selected {result.missing.length === 1 ? "product is" : "products are"} unavailable or no longer public. Remove unavailable selections to make room.</p>}
    {!result.products.length ? <p role="status">No available products selected. Choose Compare on a product to begin.</p> : <>
      {result.products.length === 1 && <p role="status">Select another product for a side-by-side comparison.</p>}
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><caption className="text-left py-3">Product prices, availability and specifications</caption><thead><tr><th scope="col" className="border p-3 text-left">Detail</th>{result.products.map((product) => <th scope="col" key={product.id} className="border p-3 text-left min-w-48"><Link href={`/products/${product.slug}`} className="underline">{product.name}</Link><p className="font-normal text-xs">Product {parsed.data.indexOf(product.id) + 1}</p></th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}><th scope="row" className="border p-3 text-left">{row.label}</th>{row.values.map((value, column) => <td key={column} className="border p-3 whitespace-pre-wrap">{value}</td>)}</tr>)}</tbody>
      </table></div>
      {!labels.size && <p>No technical specifications have been supplied for these products.</p>}
    </>}
  </main>;
}
