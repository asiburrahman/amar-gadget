"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { comparisonHref } from "@/lib/validations/comparison";
import { useComparisonStore } from "@/stores/comparison-store";

export function ComparisonSelection({ ids }: { ids: string[] }) {
  const saved = useComparisonStore((state) => state.ids), replace = useComparisonStore((state) => state.replace), remove = useComparisonStore((state) => state.remove);
  const router = useRouter();
  useEffect(() => { if (ids.length) replace(ids); }, [ids, replace]);
  return <div className="space-y-3">
    {!ids.length && saved.length > 0 && <Link href={comparisonHref(saved)} className="underline">Restore saved selection ({saved.length})</Link>}
    {ids.length > 0 && <div className="flex flex-wrap gap-3">{ids.map((id, index) => <Link key={id} href={comparisonHref(ids.filter((item) => item !== id))} onClick={() => remove(id)} className="underline">Remove product {index + 1}</Link>)}</div>}
    {(ids.length > 0 || saved.length > 0) && <button type="button" className="border rounded px-3 py-2" onClick={() => { replace([]); router.push("/compare"); }}>Clear comparison</button>}
    <Link href="/products" className="inline-block ml-3 underline">Choose more products</Link>
  </div>;
}
