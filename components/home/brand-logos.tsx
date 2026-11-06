import Link from "next/link";
export function BrandLogos({ brands = [], unavailable = false }: { brands?: { id: string; name: string; slug: string; count: number }[]; unavailable?: boolean }) {
  return <section aria-label="Catalog brands" className="py-10 border-b"><div className="max-w-7xl mx-auto px-4 space-y-4"><h2 className="text-xl font-bold">Catalog brands</h2><Link href="/brands" className="underline">Browse all brands</Link>
    {unavailable ? <p role="alert">Brand data is temporarily unavailable.</p> : !brands.length ? <p>No brands listed yet.</p> : <ul className="flex flex-wrap gap-6">{brands.map((brand) => <li key={brand.id}><Link href={`/products?brandId=${encodeURIComponent(brand.id)}`} className="underline">{brand.name}</Link><p className="text-xs">{brand.count} public products</p></li>)}</ul>}
  </div></section>;
}
