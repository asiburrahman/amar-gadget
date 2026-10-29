"use client";
import Link from "next/link";
export default function ProductError({ reset }: { reset: () => void }) {
  return <main className="container mx-auto p-6 space-y-4"><h1>Product temporarily unavailable</h1><p role="alert">Unable to load this product right now.</p><button type="button" onClick={reset}>Try again</button><Link href="/products" className="ml-4 underline">Browse products</Link></main>;
}
