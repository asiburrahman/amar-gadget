import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

export const metadata = { title: "Find your order | Amar Gadget", robots: { index: false, follow: false } };

export default async function OrderSuccessEntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id, orderId } = await searchParams;
  const parsed = z.string().uuid().safeParse(id ?? orderId);
  if (parsed.success && !(id !== undefined && orderId !== undefined)) redirect(`/order-success/${encodeURIComponent(parsed.data)}`);
  return <main className="mx-auto max-w-xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">Find your order</h1>
    <p>This link does not contain a usable order reference. It does not confirm that an order was placed or paid. Use the confirmation link from your checkout, your account order history, or order tracking with the checkout phone number.</p>
    <nav className="flex flex-wrap gap-4"><Link href="/user/orders" className="underline">Your orders</Link><Link href="/track-order" className="underline">Track an order</Link><Link href="/contact" className="underline">Contact support</Link></nav>
  </main>;
}
