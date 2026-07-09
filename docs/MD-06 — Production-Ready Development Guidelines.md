# MD-06 — Production-Ready Development Guidelines

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
Implement resilient database access patterns, transactional integrity, and optimized pagination models.

### Step-by-Step Implementation:
1. Initialize the Prisma client singleton mapping directly to the TypeScript-checked environment settings.
2. Structure operations using ACID-compliant Prisma interactive transactions.
3. Apply cursor-based pagination for high-performance listing routes.

### Real Code Example (lib/db-actions.ts):
```typescript
import { prisma } from "@/lib/prisma";

export async function processOrderCheckout({
  userId,
  cartItems,
  paymentIntentId,
}: {
  userId: string;
  cartItems: { productId: string; quantity: number }[];
  paymentIntentId: string;
}) {
  return await prisma.$transaction(async (tx) => {
    // 1. Calculate totals and check inventory
    let totalAmount = 0;
    const orderItemsData = [];

    for (const item of cartItems) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });

      if (!product || product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product: ${product?.name || item.productId}`);
      }

      // Decrement inventory
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });

      totalAmount += Number(product.price) * item.quantity;
      orderItemsData.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
      });
    }

    // 2. Create the completed order record
    const order = await tx.order.create({
      data: {
        userId,
        total: totalAmount,
        status: "PAID",
        paymentIntentId,
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: true,
      },
    });

    return order;
  });
}
```

---

## Phase 3: Secure JWT & RBAC Middleware
Handle identity validation, HTTP-only JWT verification, and Role-Based Access Control (RBAC) securely in Next.js middleware.

### Step-by-Step Implementation:
1. Intercept incoming requests using Next.js Edge Middleware.
2. Read JWT tokens stored exclusively in `httpOnly` secure cookies.
3. Validate claims using the dynamic key-verification mechanism (e.g. using `jose`).
4. Reject access for endpoints requesting higher roles than the current payload possesses.

### Real Code Example (middleware.ts):
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET);

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY);
    const userRole = payload.role as string;
    const path = request.nextUrl.pathname;

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
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/admin/:path*", "/member/:path*", "/user/:path*"],
};
```

---

## Phase 4: Server Actions & Input Validation
Design robust Next.js Server Actions incorporating absolute type schemas and detailed state reporting.

### Step-by-Step Implementation:
1. Decorate the modules with `"use server"`.
2. Extract payload and perform validation against specific schemas using Zod.
3. Protect against unauthorized mutations by checking the header-derived auth context.
4. Catch errors safely and return consistent payload structures containing state flags.

### Real Code Example (app/(marketing)/products/_actions/create-product.ts):
```typescript
"use server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createProductSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  price: z.number().positive("Price must be greater than zero"),
  stock: z.number().int().nonnegative(),
  categoryId: z.string().uuid("Invalid category ID"),
});

export type ActionState = {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

export async function createProductAction(
  userId: string,
  userRole: string,
  rawData: unknown
): Promise<ActionState> {
  if (userRole !== "MEMBER" && userRole !== "ADMIN") {
    return { success: false, message: "Unauthorized action" };
  }

  const validated = createProductSchema.safeParse(rawData);
  if (!validated.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: validated.error.flatten().fieldErrors,
    };
  }

  try {
    await prisma.product.create({
      data: {
        ...validated.data,
        sellerId: userId,
        status: userRole === "ADMIN" ? "PUBLISHED" : "PENDING_APPROVAL",
      },
    });

    return { success: true, message: "Product submitted successfully" };
  } catch (error) {
    console.error("Database operation failed:", error);
    return { success: false, message: "Internal server error occurred" };
  }
}
```

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
Implement reliable checkouts and secure asynchronous updates via cryptographically signed webhooks.

### Step-by-Step Implementation:
1. Create Stripe Payment Intent on the server.
2. Listen for incoming POST events on the webhook endpoint.
3. Cryptographically check signature validity against the local webhook secret.
4. Process events asynchronously, ensuring idempotency.

### Real Code Example (app/api/stripe/webhook/route.ts):
```typescript
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27" as any,
});

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`⚠️ Webhook signature verification failed:`, err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    
    // Ensure Idempotency
    const existingOrder = await prisma.order.findFirst({
      where: { paymentIntentId: paymentIntent.id },
    });

    if (existingOrder && existingOrder.status !== "PAID") {
      await prisma.order.update({
        where: { id: existingOrder.id },
        data: { status: "PAID" },
      });
    }
  }

  return NextResponse.json({ received: true });
}
```

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
Enforce quality metrics using isolated unit testing frameworks.

### Step-by-Step Implementation:
1. Mock the Prisma client module completely.
2. Execute target function asserting payload expectations against mock resolution.

### Real Code Example (tests/unit/product-action.test.ts):
```typescript
import { createProductAction } from "@/server/actions/product/create-product";
import { prisma } from "@/lib/prisma";

// Mock Prisma client singleton
jest.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      create: jest.fn(),
    },
  },
}));

describe("createProductAction", () => {
  it("should block non-members and non-admins from creating products", async () => {
    const response = await createProductAction("user-1", "USER", {
      name: "New iPhone",
      price: 120000,
      stock: 10,
      categoryId: "cat-1",
    });

    expect(response.success).toBe(false);
    expect(response.message).toBe("Unauthorized action");
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});
```
