import { readPrivateSecret, readApplicationOrigin } from "@/config/runtime";
import { verifyIngress } from "@/lib/ingress-protocol.cjs";

export function verifiedIngressIp(headers: Headers, method?: string, target?: string) {
  try { return verifyIngress({ headers, method, target, secret: readPrivateSecret("TRUSTED_PROXY_SECRET"), origin: readApplicationOrigin() }); }
  catch { return null; }
}
export function isAllowedRequestOrigin(headers: Headers, method: string, pathname: string) {
  const origin = headers.get("origin");
  if (origin) return origin === readApplicationOrigin();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  // Server-to-server endpoints keep their own Stripe/Bearer verification.
  return ["/api/stripe/webhook", "/api/internal/checkout/expire", "/api/internal/media/cleanup"].includes(pathname) && !headers.has("next-action");
}
