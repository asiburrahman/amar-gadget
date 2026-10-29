# MD-06 — Production-Ready Development Guidelines

Remaining code snippets are historical design examples, not current implementation instructions. [Runtime configuration and startup](RUNTIME_CONFIGURATION_RUNBOOK.md) now define the implemented contract: custom JWT/OTP authentication, production preflight and no runtime `SKIP_ENV_VALIDATION` permission. Follow that runbook and the implementation log when checking current behavior.

This document outlines the detailed step-by-step checklist and phases for implementing production-ready, enterprise-grade code within the Amar Gadget repository. Every phase focuses on secure, highly-performant, and type-safe real-world code patterns.

---

## Phase 1: Environment & Strict Type Safety
Ensure absolute environment validation at bootstrap and enforce strict compilation checking to catch errors early.

### Step-by-Step Implementation:
1. Enforce strict compiler settings in `tsconfig.json` including `"strictNullChecks": true` and `"noImplicitReturns": true`.
2. Validate all runtime variables before initialization using a central Zod schema module.
3. Utilize TypeScript type assertions/guards for dynamic runtime validation.

### Real Code Example (config/env.ts):
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection string"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
  NODE_ENV: z.enum(["development", "production", "test"]),
  NEXTAUTH_URL: z.string().url(),
});

export const validateEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Environment validation failed:", result.error.format());
    throw new Error("Invalid server environment configuration");
  }
  return result.data;
};

export const env = validateEnv();
```

---

## Phase 2: Database Layer & Prisma Transactions

Use the actual transaction-capable [Prisma client](../lib/prisma.ts). The removed legacy checkout helper trusted caller identity/payment intent, omitted effective-price/quantity/visibility rules and wrote contradictory order/payment state. It had no application call site; this was a reuse risk, not evidence of an exposed endpoint.

Current checkout starts at [createOrder](../server/actions/order/order-actions.ts). It validates requests, derives session/guest identity, obtains a server quote, serializes the attempt, atomically reserves approved available stock and creates an unpaid order. Follow the implementation/checkout runbooks and real PostgreSQL tests. Do not restore a second order writer from a design example.

---

## Phase 3: Secure JWT & RBAC Middleware (Proxy)
Handle identity validation, HTTP-only JWT verification, and Role-Based Access Control (RBAC) securely in Next.js 16 edge proxies.

### Step-by-Step Implementation:
1. Intercept incoming requests using the Next.js 16 `proxy.ts` file convention.
2. Read JWT tokens stored exclusively in `httpOnly` secure cookies.
3. Validate claims using the dynamic key-verification mechanism (e.g. using `jose`), guarding against runtime execution when `JWT_SECRET` is missing.
4. Reject access for endpoints requesting higher roles than the current payload possesses.

### Real Code Example (proxy.ts):
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const isBuildTime =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_ENV_VALIDATION === "true";

// Hard-crash at runtime if JWT_SECRET is not configured
if (!isBuildTime && !process.env.JWT_SECRET) {
  throw new Error("❌ JWT_SECRET environment variable is missing at runtime!");
}

const JWT_SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-for-build-purposes-only-32chars"
);

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  const path = request.nextUrl.pathname;

  if (!token) {
    if (path.startsWith("/admin") || path.startsWith("/member") || path.startsWith("/user")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    const userRole = payload.role as string;

    // Check RBAC paths
    if (path.startsWith("/admin") && userRole !== "ADMIN") {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
    if (path.startsWith("/member") && !["ADMIN", "MEMBER"].includes(userRole)) {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }

    const response = NextResponse.next();
    response.headers.set("x-user-id", payload.sub as string);
    response.headers.set("x-user-role", userRole);
    return response;
  } catch (error) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("auth_token");
    return response;
  }
}

export const config = {
  matcher: ["/admin/:path*", "/member/:path*", "/user/:path*"],
};
```

---

## Phase 4: Server Actions & Input Validation

The actual [seller form](../app/(dashboard)/member/add-product/page.tsx) calls the sole [createProduct action](../server/actions/product/product-actions.ts). The unused marketing wrapper was removed in AUD-048. [Strict shared validation](../lib/validations/product.ts) accepts owner upload keys, not caller image URLs or inline bytes.

Both seller and administrator publication use current-authority checks, decoded-object verification and a transaction. Every new product starts pending approval. Administrators can feature their own products but cannot bypass approval. The action returns committed ID/slug data even if subsequent cache refresh fails. The UI retains failed submissions and disables completed submissions while navigating.

Read the installed Next server-action/data-security guide before changing this boundary. Exported actions accept untrusted input; rendering restrictions are insufficient. Public detail uses the shared bounded visible-product reader in [lib/public-product.ts](../lib/public-product.ts), not an unbounded alternative.

---

## Phase 5: Rate Limiting & API Security
Secure APIs using rate limiting against bots and DDoS vectors.

### Step-by-Step Implementation:
1. Initialize connection to a fast cache database (e.g. Upstash Redis).
2. Intercept API route handlers to track IP/Token requests count.
3. Implement sliding-window logic using Redis hashes or sorted sets.
4. Respond with `429 Too Many Requests` when limits are exceeded.

### Real Code Example (lib/rate-limit.ts):
```typescript
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

export async function rateLimit(ip: string, limit = 100, windowInSeconds = 60) {
  const key = `ratelimit:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const clearBefore = now - windowInSeconds;

  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, clearBefore);
  multi.zadd(key, { score: now, member: now.toString() + Math.random().toString() });
  multi.zcard(key);
  multi.expire(key, windowInSeconds);

  const results = await multi.exec();
  const requestCount = results[2] as number;

  return {
    success: requestCount <= limit,
    limit,
    remaining: Math.max(0, limit - requestCount),
  };
}
```

---

## Phase 6: File Upload & Cloudflare R2
Manage file uploads securely by generating Signed Presigned URLs for client-side uploads, eliminating server load.

### Step-by-Step Implementation:
1. Initialize AWS SDK S3Client configured for Cloudflare R2.
2. Validate desired file metadata (MIME type, Size) before generating the signed URL.
3. Return the presigned URL to the client.

### Real Code Example (lib/cloudflare/r2.ts):
```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export async function generatePresignedUploadUrl({
  filename,
  contentType,
  maxSizeInBytes,
}: {
  filename: string;
  contentType: string;
  maxSizeInBytes: number;
}) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(contentType)) {
    throw new Error("Forbidden file format");
  }

  const key = `uploads/${Date.now()}-${filename}`;
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return { uploadUrl: url, fileKey: key };
}
```

---

## Phase 7: Payment Processing & Stripe Webhooks

Implemented paths: [Stripe configuration](../lib/stripe/stripe.ts), [durable checkout sessions](../lib/stripe/order-checkout.ts), [reservation/payment transitions](../lib/checkout-reservations.ts), [verified webhook](../app/api/stripe/webhook/route.ts). Empty checkout-session/customer/payment-intent/webhook helper exports were removed in AUD-048; they were placeholders, not integrations.

Checkout creates/retrieves a session for an existing authorized unpaid order. Browser redirects and submitted intent IDs do not prove payment. Verified webhooks and authenticated provider retrieval use amount/currency/method/session checks, order locks and idempotent transitions. Late payments stay cancelled for operator refund review. COD collection has its separate guarded fulfillment path.

Follow the checkout/reservation runbooks and actual SQL/webhook tests. Hosted Stripe/browser verification remains a release gate; test signatures/fixtures are not live payment evidence.

---

## Phase 8: State Management & Client-side Caching
Design stores leveraging Zustand with local synchronization mechanisms and custom hook adapters.

### Step-by-Step Implementation:
1. Define actions modifying state values within a Zustand store.
2. Synchronize store actions with optimistic rendering layouts.

### Real Code Example (stores/cart-store.ts):
```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (newItem) =>
        set((state) => {
          const exists = state.items.find((item) => item.id === newItem.id);
          if (exists) {
            return {
              items: state.items.map((item) =>
                item.id === newItem.id
                  ? { ...item, quantity: item.quantity + newItem.quantity }
                  : item
              ),
            };
          }
          return { items: [...state.items, newItem] };
        }),
      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),
      clearCart: () => set({ items: [] }),
    }),
    { name: "cart-storage" }
  )
);
```

---

## Phase 9: Typography, SEO & Accessibility
Implement standards to boost page loading indexing scores and SEO attributes.

### Step-by-Step Implementation:
1. Define canonical properties on sitemap.xml models.
2. Implement structured JSON-LD schemas inside product pages.

### Real Code Example (app/(marketing)/products/[slug]/page.tsx):
```typescript
import { Metadata } from "next";
import { prisma } from "@/lib/prisma";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const product = await prisma.product.findUnique({
    where: { id: params.slug }, // or slug field
  });

  if (!product) return {};

  return {
    title: `${product.name} | Amar Gadget`,
    description: product.description,
    openGraph: {
      title: product.name,
      description: product.description,
      images: [{ url: product.imageUrl }],
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await prisma.product.findUnique({
    where: { id: params.slug },
  });

  if (!product) return <div>Product not found</div>;

  // Render structured schema data (JSON-LD) for Google Search SEO indexing
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.imageUrl,
    description: product.description,
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: "BDT",
      availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="container mx-auto p-6">
        <h1 className="text-4xl font-bold font-sans">{product.name}</h1>
        <p className="mt-4 text-gray-700">{product.description}</p>
        <span className="text-2xl font-semibold mt-2 block">
          {product.price} BDT
        </span>
      </main>
    </>
  );
}
```

---

## Phase 10: Testing & Test Mocks

Test actual entry points. [Product media integration](../tests/integration/product-media.test.ts) calls the seller form's action with PostgreSQL, real SigV4 HTTP, AWS SDK and Sharp. It verifies seller/admin publication, ownership, approval, validation, provider failure, current authority and committed-result behavior. [Seller form DOM tests](../tests/unit/product-media-ui.test.tsx) explicitly mock network/action boundaries for gating, payloads, retry/cancellation, success, blocked resubmission and navigation cleanup. They do not certify hosted browser CORS.

[Marketplace transaction tests](../tests/integration/marketplace-transactions.test.ts) invoke actual checkout/quote/retry/signed-webhook handlers with an isolated database and explicit provider boundaries. [Prepared action smoke](../scripts/smoke-catalog-actions.mjs) exercises production Next Action/Flight transport and verifies retired exports are absent from the compiled manifest.

Use TEST_DATABASE_URL only with an isolated local audit_* database. Run relevant Jest tests, TypeScript, affected-file lint, production build and prepared HTTP smokes. Record exact results and external limits in [the implementation log](CODEX_IMPLEMENTATION_LOG.md). Design snippets and passing mocked responses are not production evidence.
