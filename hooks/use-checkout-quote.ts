"use client";
import { useCallback, useEffect, useState } from "react";
import type { CheckoutQuote } from "@/lib/checkout-quote";
import type { OrderItemInput } from "@/lib/validations/order";

export async function fetchCheckoutQuote(items: OrderItemInput[], couponCode: string | null, paymentMethod: "COD" | "STRIPE" = "COD", signal?: AbortSignal): Promise<CheckoutQuote> {
  const response = await fetch("/api/checkout/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, couponCode: couponCode || undefined, paymentMethod }), cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Unable to calculate your total.");
  return data.quote;
}

export function useCheckoutQuote(items: OrderItemInput[], couponCode: string | null, paymentMethod: "COD" | "STRIPE" = "COD", enabled = true, contextKey = "") {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify({ items, couponCode, paymentMethod, revision, contextKey });
  const [result, setResult] = useState<{ key: string; quote: CheckoutQuote | null; error: string }>({ key: "", quote: null, error: "" });
  useEffect(() => {
    if (!enabled || !items.length) return;
    const controller = new AbortController();
    const payload = JSON.parse(key);
    void fetchCheckoutQuote(payload.items, payload.couponCode, payload.paymentMethod, controller.signal)
      .then((quote) => { if (!controller.signal.aborted) setResult({ key, quote, error: "" }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, quote: null, error: error.message }); });
    return () => controller.abort();
  }, [key, enabled, items.length]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const current = result.key === key && enabled && items.length > 0;
  return { quote: current ? result.quote : null, error: current ? result.error : "", loading: enabled && items.length > 0 && !current, refresh };
}
