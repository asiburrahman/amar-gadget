"use client";
import { useState } from "react";
import Link from "next/link";
import { useComparisonStore } from "@/stores/comparison-store";
import { comparisonHref } from "@/lib/validations/comparison";

export function CompareButton({ productId, name }: { productId: string; name: string }) {
  const ids = useComparisonStore((state) => state.ids), add = useComparisonStore((state) => state.add), remove = useComparisonStore((state) => state.remove);
  const [error, setError] = useState(""); const selected = ids.includes(productId);
  return <div className="text-xs space-y-1"><button type="button" aria-pressed={selected} aria-label={`${selected ? "Remove" : "Add"} ${name} ${selected ? "from" : "to"} comparison`} onClick={() => { setError(""); if (selected) remove(productId); else if (!add(productId)) setError("Compare up to four products. Remove one to add another."); }} className="border rounded px-2 py-1">{selected ? "Selected for comparison" : "Compare"}</button>
    {selected && <Link className="ml-2 underline" href={comparisonHref(ids)}>View comparison ({ids.length})</Link>}{error && <p role="alert">{error}</p>}
  </div>;
}

export function ComparisonLink() {
  const ids = useComparisonStore((state) => state.ids);
  return <Link href={comparisonHref(ids)} className="text-xs font-semibold" aria-label={`Compare products (${ids.length} selected)`}>Compare ({ids.length})</Link>;
}
