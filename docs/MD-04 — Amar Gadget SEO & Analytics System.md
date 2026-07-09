# MD-04 — Amar Gadget SEO & Analytics System

````md id="f7m2qa"
# MD-04 — Amar Gadget SEO & Analytics
## Production SEO + Tracking Architecture
### Next.js 16 App Router + GA4 + GTM + Meta Pixel + JSON-LD

---

# 1. SEO SYSTEM GOALS

The SEO architecture for Amar Gadget must provide:

- high Google discoverability
- ecommerce SEO optimization
- product indexing
- fast page rendering
- structured metadata
- social sharing optimization
- analytics tracking
- conversion attribution
- privacy-aware analytics

The system must support:
- thousands of products
- dynamic metadata
- ISR caching
- multi-vendor pages
- future blog/content marketing

---

# 2. SEO ARCHITECTURE OVERVIEW

---

# REQUIRED SEO FEATURES

Every route must support:

- generateMetadata()
- canonical URLs
- Open Graph
- Twitter Cards
- robots directives
- JSON-LD schema
- sitemap inclusion
- semantic heading structure

---

# REQUIRED ANALYTICS

Implement:
- Google Tag Manager
- GA4
- Meta Pixel
- Conversion API (CAPI)
- Core Web Vitals tracking

---

# PRIVACY REQUIREMENTS

NEVER:
- store PII in analytics
- track before consent
- expose private customer data

---

# 3. SEO FOLDER STRUCTURE

```bash id="l8m4qc"
lib/seo/
│
├── metadata.ts
├── schema.ts
├── sitemap.ts
├── robots.ts
├── canonical.ts
├── open-graph.ts
├── twitter.ts
└── breadcrumbs.ts
````

---

# 4. METADATA FACTORY SYSTEM

Use centralized metadata generation.

---

# FILE

```bash id="wejlwm"
lib/seo/metadata.ts
```

---

# EXAMPLE

```ts id="s40hzh"
import type { Metadata } from "next";

interface MetadataProps {
  title: string;
  description: string;
  image?: string;
  keywords?: string[];
}

export function createMetadata({
  title,
  description,
  image,
  keywords,
}: MetadataProps): Metadata {
  return {
    title,
    description,
    keywords,
    metadataBase: new URL("https://amargadget.com"),
    alternates: {
      canonical: "/",
    },
    openGraph: {
      title,
      description,
      url: "https://amargadget.com",
      siteName: "Amar Gadget",
      images: [
        {
          url:
            image ??
            "https://amargadget.com/og-image.jpg",
          width: 1200,
          height: 630,
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        image ??
          "https://amargadget.com/og-image.jpg",
      ],
    },
  };
}
```

---

# 5. ROUTE METADATA USAGE

## Example Product Page

```tsx id="7h89sh"
import { createMetadata } from "@/lib/seo/metadata";

export async function generateMetadata() {
  return createMetadata({
    title: "iPhone 15 Pro Max",
    description:
      "Buy original iPhone 15 Pro Max in Bangladesh.",
  });
}
```

---

# 6. CANONICAL URL RULES

Every page MUST define canonical URLs.

---

# GOOD

```ts id="ifn0tv"
alternates: {
  canonical: "/products/iphone-15-pro-max"
}
```

---

# BAD

Missing canonical URLs.

This creates:

* duplicate indexing
* SEO penalties

---

# 7. JSON-LD STRUCTURED DATA

Structured data is REQUIRED.

---

# REQUIRED SCHEMAS

| Schema         | Usage              |
| -------------- | ------------------ |
| Organization   | brand identity     |
| WebSite        | search indexing    |
| Product        | ecommerce products |
| BreadcrumbList | navigation         |
| FAQPage        | FAQ sections       |
| Article        | blog pages         |

---

# 8. ORGANIZATION SCHEMA

## lib/seo/schema.ts

```ts id="gnj1hc"
export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Amar Gadget",
  url: "https://amargadget.com",
  logo: "https://amargadget.com/logo.png",
  sameAs: [
    "https://facebook.com/amargadget",
    "https://instagram.com/amargadget",
  ],
};
```

---

# 9. PRODUCT JSON-LD

```ts id="35bf7l"
export function productSchema(product: {
  name: string;
  description: string;
  image: string;
  price: number;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: product.price,
      availability:
        "https://schema.org/InStock",
    },
  };
}
```

---

# 10. BREADCRUMB SCHEMA

Required for:

* product pages
* categories
* blog pages

---

# EXAMPLE

```ts id="h9p94e"
export const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
};
```

---

# 11. FAQ SCHEMA

Use on:

* FAQ page
* product FAQ
* shipping FAQ

Benefits:

* rich snippets
* higher CTR

---

# 12. SITEMAP SYSTEM

Use dynamic sitemap generation.

---

# FILE

```bash id="c4g0m8"
app/sitemap.ts
```

---

# EXAMPLE

```ts id="8msz8i"
import { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    {
      url: "https://amargadget.com",
      lastModified: new Date(),
    },
  ];
}
```

---

# INCLUDE

* products
* categories
* brands
* blog posts
* static pages

---

# 13. ROBOTS.TXT

## FILE

```bash id="g22h2o"
app/robots.ts
```

---

# EXAMPLE

```ts id="d3khxh"
import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/api",
      ],
    },
    sitemap: "https://amargadget.com/sitemap.xml",
  };
}
```

---

# 14. OPEN GRAPH RULES

Required:

* every marketing page
* products
* blog pages

---

# IMAGE SIZE

Recommended:

```txt id="9cxmxv"
1200x630
```

---

# FORMAT

Use:

* WebP
* optimized CDN images

---

# 15. TWITTER CARD RULES

Use:

```txt id="olhjx2"
summary_large_image
```

for products and blogs.

---

# 16. GOOGLE TAG MANAGER

---

# INSTALLATION

## app/layout.tsx

```tsx id="h3lphk"
import Script from "next/script";

<Script
  id="gtm"
  strategy="afterInteractive"
>
  {`
    (function(w,d,s,l,i){w[l]=w[l]||[];
    w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});
    var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?
    '&l='+l:'';
    j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;
    f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer',
    '${process.env.NEXT_PUBLIC_GTM_ID}');
  `}
</Script>
```

---

# 17. GA4 EVENTS

Track:

| Event          | Purpose         |
| -------------- | --------------- |
| view_item      | product view    |
| add_to_cart    | cart tracking   |
| begin_checkout | checkout        |
| purchase       | completed order |
| login          | auth            |
| sign_up        | registration    |

---

# 18. DATA LAYER RULES

NEVER SEND:

* email
* phone number
* address
* payment info

---

# SAFE DATA ONLY

Allowed:

* product ID
* product name
* category
* value
* currency

---

# 19. META PIXEL

Use:

* browser events
* server-side CAPI

---

# META PIXEL EVENTS

Track:

* ViewContent
* AddToCart
* InitiateCheckout
* Purchase

---

# 20. CONVERSIONS API (CAPI)

Use server-side route handlers.

---

# FOLDER

```bash id="h8gskh"
app/api/meta/capi/
```

---

# BENEFITS

* better attribution
* ad optimization
* iOS tracking recovery

---

# 21. CONSENT MANAGEMENT

Tracking MUST be:

* consent gated
* GDPR friendly
* privacy compliant

---

# REQUIRED

Before tracking:

```ts id="tm5m5o"
analyticsConsent === true
```

---

# 22. CORE WEB VITALS

Track:

* LCP
* CLS
* FID
* INP
* TTFB

---

# FILE

```bash id="9kk04s"
lib/analytics/web-vitals.ts
```

---

# EXAMPLE

```ts id="5u0c4t"
export function reportWebVitals(metric: any) {
  console.log(metric);
}
```

---

# 23. PERFORMANCE SEO RULES

---

# IMAGE OPTIMIZATION

Always use:

```tsx id="rmg8f4"
next/image
```

---

# ENABLE

* AVIF
* WebP
* blur placeholders
* lazy loading

---

# ISR STRATEGY

Use ISR for:

* products
* categories
* brands

---

# RECOMMENDED REVALIDATE

```ts id="b3i9zt"
export const revalidate = 300;
```

---

# 24. DYNAMIC PRODUCT SEO

Each product page must generate:

* title
* description
* keywords
* OG image
* Product schema

from database data.

---

# 25. CATEGORY SEO

Each category page should support:

* optimized intro text
* dynamic metadata
* canonical URLs

---

# 26. BLOG SEO

Blog pages must support:

* Article schema
* author metadata
* publish dates
* reading time

---

# 27. INTERNAL LINKING RULES

Always link:

* related products
* categories
* brands
* blog articles

Benefits:

* SEO crawling
* session depth
* conversion improvement

---

# 28. URL STRUCTURE RULES

GOOD:

```txt id="k13x9l"
/products/iphone-15-pro-max
```

BAD:

```txt id="ik6u7s"
/product?id=123
```

---

# 29. SECURITY RULES

NEVER expose:

* analytics secrets
* Meta tokens
* Stripe secrets

---

# USE

```env id="22hqqt"
NEXT_PUBLIC_
```

ONLY for public keys.

---

# 30. HEADERS

Add:

* CSP
* Referrer-Policy
* Permissions-Policy

in:

```ts id="9c2y0z"
next.config.ts
```

---

# 31. MONITORING TOOLS

Recommended:

* Google Search Console
* Bing Webmaster Tools
* Vercel Analytics
* Lighthouse CI

---

# 32. ECOMMERCE SEO PRIORITIES

Highest priority pages:

1. product pages
2. category pages
3. brand pages
4. blog articles

---

# 33. BANGLADESH SEO CONSIDERATIONS

Optimize for:

* mobile-first indexing
* low bandwidth
* fast TTFB in Asia region

Deploy:

* Singapore region
* Cloudflare CDN enabled

---

# 34. ACCESSIBILITY SEO

Use:

* semantic headings
* alt text
* aria labels

Benefits:

* accessibility
* SEO ranking improvements

---

# 35. FINAL SEO GOALS

The Amar Gadget SEO system must provide:

* high discoverability
* rich search results
* strong Core Web Vitals
* scalable metadata generation
* conversion tracking
* privacy-safe analytics
* ecommerce SEO optimization
* production-grade performance

The architecture must remain:

* modular
* maintainable
* AI-friendly
* scalable

```
```
