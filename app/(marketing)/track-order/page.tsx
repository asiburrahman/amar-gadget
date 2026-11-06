import OrderTracking from "@/components/orders/order-tracking";

export default async function TrackOrderPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  return <OrderTracking initialOrderId={typeof id === "string" && id.length <= 120 ? id : ""} />;
}
