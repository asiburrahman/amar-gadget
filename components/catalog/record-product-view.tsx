"use client";
import { useEffect } from "react";
import { useRecentHistoryStore } from "@/stores/recent-history-store";
export function RecordProductView({ productId }: { productId: string }) {
  const record = useRecentHistoryStore((state) => state.record);
  useEffect(() => { record(productId); }, [productId, record]);
  return null;
}
