export interface ProductSchemaInput {
  name: string;
  description: string;
  image: string;
  price: number;
  currency?: string;
  availability?: "InStock" | "OutOfStock" | "PreOrder";
  sku?: string;
  brandName?: string;
}

export interface BreadcrumbItemInput {
  name: string;
  url: string;
}

export interface FAQItemInput {
  question: string;
  answer: string;
}

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://amargadget.com";

export function generateOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Amar Gadget",
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: [
      "https://facebook.com/amargadget",
      "https://instagram.com/amargadget",
      "https://twitter.com/amargadget",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+880-1700-000000",
      contactType: "customer service",
      areaServed: "BD",
      availableLanguage: ["en", "bn"],
    },
  };
}

export function generateWebsiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Amar Gadget",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function generateProductSchema(product: ProductSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: [product.image],
    sku: product.sku || product.name.toLowerCase().replace(/\s+/g, "-"),
    brand: {
      "@type": "Brand",
      name: product.brandName || "Amar Gadget",
    },
    offers: {
      "@type": "Offer",
      url: SITE_URL,
      priceCurrency: product.currency || "BDT",
      price: product.price,
      priceValidUntil: new Date(Date.now() + 31536000000).toISOString().split("T")[0],
      itemCondition: "https://schema.org/NewCondition",
      availability: `https://schema.org/${product.availability || "InStock"}`,
      seller: {
        "@type": "Organization",
        name: "Amar Gadget",
      },
    },
  };
}

export function generateBreadcrumbSchema(items: BreadcrumbItemInput[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

export function generateFAQSchema(faqs: FAQItemInput[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}