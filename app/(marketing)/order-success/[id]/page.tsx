import Link from "next/link";
import { getOrderById } from "@/server/actions/order/order-actions";
import { OrderConfirmation } from "@/components/checkout/order-confirmation";

export default async function OrderSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderById(id);
  if (!result.success || !result.data) {
    const unavailable = result.code === "ORDER_UNAVAILABLE";
    return <main className="mx-auto my-16 max-w-xl space-y-4 p-6 text-center">
      <h1 className="text-2xl font-bold">{unavailable ? "Order details temporarily unavailable" : "Order not found or access expired"}</h1>
      <p>{unavailable ? "Please reload this page shortly. Do not place a duplicate order." : "Use the original checkout browser or sign in to the account that placed this order."}</p>
      <Link href="/track-order" className="underline">Track an order with your checkout phone number</Link>
    </main>;
  }
  return <OrderConfirmation key={result.data.id} initialOrder={result.data} />;
}
