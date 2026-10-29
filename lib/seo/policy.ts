export const NO_INDEX = { index: false, follow: false } as const;
export function privateIndexPath(path: string) {
  return /^\/(?:api|admin|member|user|account|cart|checkout|compare|wishlist|track-order|order-success|search|unauthorized|login|register|verify-email|verify-otp|forgot-password|reset-password)(?:\/|$)/.test(path);
}
// Only existing, indexable public destinations. Placeholder/personal flows are
// excluded; content completion can add their reviewed pages later.
export const SITEMAP_PUBLIC_PATHS = ["/", "/products", "/categories", "/brands", "/deals", "/about", "/contact", "/faq", "/returns"] as const;
