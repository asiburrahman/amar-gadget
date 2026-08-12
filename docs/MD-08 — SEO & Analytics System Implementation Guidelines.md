# MD-08 — SEO & Analytics System Implementation Guidelines

This guide details the step-by-step implementation phases for the complete SEO and Analytics system of Amar Gadget, utilizing Next.js 16 App Router, TypeScript, Google Tag Manager (GTM), GA4, Meta Pixel & Conversions API (CAPI), and JSON-LD structured data.

---

## Phase 1: Centralized Metadata Factory
Build a robust factory function to generate consistent, SEO-optimized `Metadata` objects across all static and dynamic routes.

### Target File: `lib/seo/metadata.ts`
```ts
import type { Metadata } from "next";

export interface MetadataProps {
  title: string;
  description: string;
  image?: string;
  keywords?: string[];
  canonicalUrl?: string;
  noIndex?: boolean;
  type?: "website" | "article";
  publishedTime?: string;
  authors?: string[];
}

const getBaseUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "https://amargadget.com";
  const prefixedUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
  return prefixedUrl.replace(/\/$/, "");
};

const DEFAULT_SITE_URL = getBaseUrl();
const DEFAULT_OG_IMAGE = `${DEFAULT_SITE_URL}/og-image.jpg`;
const DEFAULT_DESCRIPTION =
  "Amar Gadget is Bangladesh's premier multi-vendor marketplace for flagship smartphones, laptops, audio, and gadgets with official warranty.";

export function createMetadata({
  title,
  description,
  image,
  keywords = ["electronics", "gadgets", "smartphone", "laptop", "Bangladesh", "Amar Gadget"],
  canonicalUrl,
  noIndex = false,
  type = "website",
  publishedTime,
  authors,
}: MetadataProps): Metadata {
  const siteName = "Amar Gadget";
  
  // Prevent duplicate brand suffixes if title already includes "Amar Gadget"
  const fullTitle = title.includes(siteName) ? title : `${title} | ${siteName}`;

  // Sanitize description
  const cleanDescription = (description || DEFAULT_DESCRIPTION).trim();

  // Resolve absolute image URL safely
  let ogImageUrl = DEFAULT_OG_IMAGE;
  if (image) {
    if (image.startsWith("http://") || image.startsWith("https://")) {
      ogImageUrl = image;
    } else if (image.startsWith("//")) {
      ogImageUrl = `https:${image}`;
    } else {
      ogImageUrl = `${DEFAULT_SITE_URL}${image.startsWith("/") ? "" : "/"}${image}`;
    }
  }

  // Resolve canonical path safely
  const canonicalPath = canonicalUrl
    ? canonicalUrl.startsWith("http")
      ? canonicalUrl
      : `${DEFAULT_SITE_URL}${canonicalUrl.startsWith("/") ? "" : "/"}${canonicalUrl}`
    : DEFAULT_SITE_URL;

  return {
    title: fullTitle,
    description: cleanDescription,
    keywords,
    applicationName: siteName,
    authors: authors ? authors.map((name) => ({ name })) : [{ name: siteName }],
    generator: "Next.js",
    publisher: siteName,
    metadataBase: new URL(DEFAULT_SITE_URL),
    alternates: {
      canonical: canonicalPath,
    },
    robots: {
      index: !noIndex,
      follow: !noIndex,
      googleBot: {
        index: !noIndex,
        follow: !noIndex,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      title: fullTitle,
      description: cleanDescription,
      url: canonicalPath,
      siteName,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: "en_US",
      type,
      ...(publishedTime && { publishedTime }),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: cleanDescription,
      images: [ogImageUrl],
      creator: "@amargadget",
      site: "@amargadget",
    },
  };
}
```

---

## Phase 2: JSON-LD Structured Data Generators
Implement type-safe schema generators for Organization, Product, BreadcrumbList, FAQ, and WebSite schemas to power rich search snippets.

### Target File: `lib/seo/schema.ts`
```ts
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
```

---

## Phase 3: Dynamic Sitemap Generator
Build an asynchronous Next.js dynamic sitemap fetching published products and categories directly from the database.

### Target File: `app/sitemap.ts`
```ts
import { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://amargadget.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${SITE_URL}/products`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/categories`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/brands`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/deals`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy-policy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  try {
    const publishedProducts = await prisma.product.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, name: true, updatedAt: true },
      take: 1000,
    });

    const productRoutes: MetadataRoute.Sitemap = publishedProducts.map((product) => ({
      url: `${SITE_URL}/products/${product.id}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    }));

    const categories = await prisma.category.findMany({
      select: { slug: true, updatedAt: true },
    });

    const categoryRoutes: MetadataRoute.Sitemap = categories.map((cat) => ({
      url: `${SITE_URL}/categories/${cat.slug}`,
      lastModified: cat.updatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    }));

    return [...staticRoutes, ...productRoutes, ...categoryRoutes];
  } catch (error) {
    console.error("Failed to generate dynamic sitemap entries:", error);
    return staticRoutes;
  }
}
```

---

## Phase 4: Search Engine Directive (`robots.ts`)
Configure web crawler access rules, blocking indexing for private dashboard and API paths.

### Target File: `app/robots.ts`
```ts
import { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://amargadget.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/member/",
        "/user/",
        "/api/",
        "/checkout/",
        "/login",
        "/register",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
```

---

## Phase 5: Breadcrumbs Utility
Construct helper functions to derive structured breadcrumbs for navigation and JSON-LD markup.

### Target File: `lib/seo/breadcrumbs.ts`
```ts
import { generateBreadcrumbSchema, BreadcrumbItemInput } from "./schema";

export function getProductBreadcrumbs(categoryName: string, categorySlug: string, productName: string) {
  const items: BreadcrumbItemInput[] = [
    { name: "Home", url: "/" },
    { name: "Products", url: "/products" },
    { name: categoryName, url: `/categories/${categorySlug}` },
    { name: productName, url: "#" },
  ];

  return {
    items,
    schema: generateBreadcrumbSchema(items),
  };
}

export function getCategoryBreadcrumbs(categoryName: string) {
  const items: BreadcrumbItemInput[] = [
    { name: "Home", url: "/" },
    { name: "Categories", url: "/categories" },
    { name: categoryName, url: "#" },
  ];

  return {
    items,
    schema: generateBreadcrumbSchema(items),
  };
}
```

---

## Phase 6: Google Tag Manager & GA4 Integration
Implement non-blocking Next.js script loading and a privacy-safe DataLayer event dispatching helper.

### Target File: `components/analytics/gtm-script.tsx`
```tsx
"use client";

import Script from "next/script";

export function GTMScript() {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID;

  if (!gtmId) return null;

  return (
    <Script id="gtm-script" strategy="afterInteractive">
      {`
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${gtmId}');
      `}
    </Script>
  );
}
```

### Target File: `lib/analytics/ga.ts`
```ts
type GAEventParams = {
  action: string;
  category?: string;
  label?: string;
  value?: number;
  [key: string]: any;
};

export function sendGAEvent({ action, ...params }: GAEventParams) {
  if (typeof window !== "undefined" && (window as any).dataLayer) {
    (window as any).dataLayer.push({
      event: action,
      ...params,
    });
  }
}
```

---

## Phase 7: Meta Pixel & Conversions API (CAPI)
Integrate client-side Meta Pixel tracking component and a secure server-side CAPI proxy endpoint.

### Target File: `components/analytics/meta-pixel-script.tsx`
```tsx
"use client";

import Script from "next/script";

export function MetaPixelScript() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  if (!pixelId) return null;

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${pixelId}');
        fbq('track', 'PageView');
      `}
    </Script>
  );
}
```

### Target File: `app/api/meta/capi/route.ts`
```ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return NextResponse.json({ error: "CAPI unconfigured" }, { status: 500 });
  }

  try {
    const { eventName, eventSourceUrl, eventData } = await req.json();

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_source_url: eventSourceUrl,
          custom_data: eventData,
        },
      ],
    };

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Meta CAPI dispatch error:", error);
    return NextResponse.json({ error: "Failed to dispatch CAPI event" }, { status: 500 });
  }
}
```

---

## Phase 8: Privacy-Aware Consent Management
Implement cookie consent checking to enforce privacy standards before firing analytics scripts.

### Target File: `lib/analytics/consent.ts`
```ts
export const CONSENT_STORAGE_KEY = "amar_gadget_analytics_consent";

export function getAnalyticsConsent(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(CONSENT_STORAGE_KEY) === "true";
}

export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_STORAGE_KEY, granted ? "true" : "false");
  window.dispatchEvent(new Event("consent_updated"));
}
```

---

## Phase 9: Core Web Vitals Monitoring
Export a reporter function to send Web Vitals measurements to analytics services.

### Target File: `lib/analytics/web-vitals.ts`
```ts
import { sendGAEvent } from "./ga";

export function reportWebVitals(metric: {
  id: string;
  name: string;
  label: string;
  value: number;
}) {
  sendGAEvent({
    action: "web_vitals",
    category: "Web Vitals",
    label: metric.name,
    value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
    nonInteraction: true,
  });
}
```

---

## Phase 10: Dynamic Route Integration & ISR
Integrate metadata, JSON-LD schemas, and ISR caching (`revalidate = 300`) into dynamic routes.

### Target File: `app/(marketing)/products/[slug]/page.tsx`
```tsx
import { notFound } from "next/navigation";
import { createMetadata } from "@/lib/seo/metadata";
import { generateProductSchema } from "@/lib/seo/schema";
import { getProductBreadcrumbs } from "@/lib/seo/breadcrumbs";
import { H1, P } from "@/components/ui/typography";
import { formatCurrency } from "@/lib/formatter";

export const revalidate = 300; // Revalidate every 5 minutes (ISR)

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

async function getProduct(slug: string) {
  if (slug === "iphone-16-pro-max") {
    return {
      id: "prod-1",
      name: "Apple iPhone 16 Pro Max 256GB",
      description: "Flagship iPhone 16 Pro Max with Natural Titanium finish and A18 Pro chip.",
      price: 165000,
      imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80",
      categoryName: "Mobile Phones",
      categorySlug: "mobile-phones",
    };
  }
  return null;
}

export async function generateMetadata({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    return createMetadata({
      title: "Product Not Found",
      description: "The requested product does not exist on Amar Gadget.",
      noIndex: true,
    });
  }

  return createMetadata({
    title: product.name,
    description: product.description,
    image: product.imageUrl,
    canonicalUrl: `/products/${slug}`,
  });
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  const productJsonLd = generateProductSchema({
    name: product.name,
    description: product.description,
    image: product.imageUrl,
    price: product.price,
  });

  const { schema: breadcrumbsJsonLd } = getProductBreadcrumbs(
    product.categoryName,
    product.categorySlug,
    product.name
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <H1>{product.name}</H1>
        <P className="text-xl font-bold text-primary mt-4">
          {formatCurrency(product.price)}
        </P>
        <P className="mt-4">{product.description}</P>
      </div>
    </>
  );
}
```

---

## Phase 11: SEO Guard Accessibility & Header Enforcement
Enforce single `H1` tag rules and monitor heading hierarchies during development.

### Target File: `components/shared/seo-guard.tsx`
```tsx
"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";

interface SEOGuardProps {
  children: React.ReactNode;
  disabled?: boolean;
}

export function SEOGuard({ children, disabled = false }: SEOGuardProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || disabled) {
      return;
    }

    const timer = setTimeout(() => {
      const h1Elements = document.querySelectorAll("h1");
      const h1Count = h1Elements.length;

      if (h1Count > 1) {
        console.warn(
          `[SEO Guard Warning] Route "${pathname}": Found ${h1Count} H1 elements. Search engines prefer exactly 1 H1 element per page.`
        );
      } else if (h1Count === 0) {
        console.warn(
          `[SEO Guard Warning] Route "${pathname}": No H1 element found. Search engines prefer exactly 1 H1 element per page for accessibility.`
        );
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [pathname, disabled]);

  return <>{children}</>;
}
```

---

## Phase 12: Security & Caching Headers Configuration
Configure security headers and image optimization formats in Next.js config.

### Target File: `next.config.ts`
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```
