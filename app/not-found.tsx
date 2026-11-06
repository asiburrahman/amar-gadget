import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto max-w-xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">Page not found</h1>
    <p>This page is unavailable or has not been published. Check the address or use the links below.</p>
    <nav className="flex flex-wrap gap-4">
      <Link href="/products" className="underline">Browse products</Link>
      <Link href="/blog" className="underline">Published articles</Link>
      <Link href="/contact" className="underline">Contact support</Link>
    </nav>
  </main>;
}
