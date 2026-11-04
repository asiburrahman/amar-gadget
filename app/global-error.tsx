"use client";
import { ServiceErrorView } from "@/components/shared/service-error";
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return <html lang="en"><head><title>Service temporarily unavailable | Amar Gadget</title><meta name="robots" content="noindex, nofollow" /></head><body style={{ fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}><ServiceErrorView error={error} retry={retry} /></body></html>;
}
