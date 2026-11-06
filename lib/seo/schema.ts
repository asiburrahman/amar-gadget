import { STORE_CURRENCY } from "@/lib/currency";
import { canonicalUrl, productPath, publicImageUrl } from "./urls";
export interface ProductSchemaInput { id: string; slug: string; name: string; description: string; image?: string | null; price: number; stock: number; sku?: string; brandName?: string; categoryName?: string }
export interface BreadcrumbItemInput { name: string; url: string }
export interface FAQItemInput { question: string; answer: string }
export function generateOrganizationSchema() {
  return { "@context": "https://schema.org", "@type": "Organization", "@id": canonicalUrl("/") + "#organization", name: "Amar Gadget", url: canonicalUrl("/") };
}
export function generateWebsiteSchema() {
  return { "@context": "https://schema.org", "@type": "WebSite", name: "Amar Gadget", url: canonicalUrl("/"), potentialAction: { "@type": "SearchAction", target: canonicalUrl("/search") + "?q={search_term_string}", "query-input": "required name=search_term_string" } };
}
export function generateProductSchema(product: ProductSchemaInput) {
  if (!Number.isFinite(product.price) || product.price < 0 || !Number.isInteger(product.stock) || product.stock < 0) throw new Error("Invalid product offer.");
  const url = canonicalUrl(productPath(product.slug, product.id)), image = publicImageUrl(product.image);
  return { "@context": "https://schema.org", "@type": "Product", "@id": url + "#product", url, name: product.name, description: product.description,
    ...(image ? { image: [image] } : {}), sku: product.sku ?? product.id,
    ...(product.brandName ? { brand: { "@type": "Brand", name: product.brandName } } : {}),
    ...(product.categoryName ? { category: product.categoryName } : {}),
    offers: { "@type": "Offer", url, priceCurrency: STORE_CURRENCY, price: product.price, availability: `https://schema.org/${product.stock > 0 ? "InStock" : "OutOfStock"}` },
  };
}
export function generateBreadcrumbSchema(items: BreadcrumbItemInput[]) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: canonicalUrl(item.url) })) };
}
export function generateFAQSchema(faqs: FAQItemInput[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) };
}
