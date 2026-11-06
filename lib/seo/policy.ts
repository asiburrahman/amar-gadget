export const NO_INDEX = { index: false, follow: false } as const;
export function privateIndexPath(path: string) {
  return /^\/(?:api|admin|member|user|account|cart|checkout|compare|wishlist|track-order|order-success|search|unauthorized|login|register|verify-email|verify-otp|forgot-password|reset-password)(?:\/|$)/.test(path);
}
// Operator information pages and articles are added from retained publications
// at request time. Unpublished navigation guides are intentionally noindex.
export const SITEMAP_PUBLIC_PATHS = ["/", "/products", "/categories", "/brands", "/deals", "/contact"] as const;
