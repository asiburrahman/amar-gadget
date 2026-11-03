/** Purchase labels remain stable when the live catalog is edited. Legacy
 * upgrades preserve the formerly displayed label with LEGACY_CURRENT provenance. */
export function purchasedProduct<P extends { name: string; slug?: string }>(item: { productName?: string | null; productSlug?: string | null; product: P }) {
  return { ...item.product, name: item.productName ?? item.product.name, ...("slug" in item.product ? { slug: item.productSlug ?? item.product.slug } : {}) };
}
