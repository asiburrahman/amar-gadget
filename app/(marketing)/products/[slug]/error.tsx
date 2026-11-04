"use client";
import { ServiceErrorView } from "@/components/shared/service-error";
export default function ProductError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ServiceErrorView error={error} retry={retry} title="Product temporarily unavailable" href="/products" linkLabel="Browse products" />;
}
