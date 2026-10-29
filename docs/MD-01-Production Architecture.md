# MD-01 — Amar Gadget Folder Structure (Production Architecture)

This is a historical design specification. Current environment/startup requirements are defined by [the runtime runbook](RUNTIME_CONFIGURATION_RUNBOOK.md) and `config/runtime.ts`; older NextAuth settings and environment bypass examples below are superseded. Use the implementation log for verified feature status.

````md
# MD-01 — Amar Gadget Folder Structure
## Production Architecture
### Next.js 16 + Prisma + PostgreSQL + Stripe + Nodemailer + Cloudflare R2

---

# 1. Project Overview

Amar Gadget is a production-grade multi-vendor ecommerce platform with:

- Role-based access system
- Admin dashboard
- Member/Seller dashboard
- User dashboard
- Stripe payment integration
- Email OTP verification
- Product approval workflow
- SEO optimization
- Enterprise security architecture

This architecture is optimized for:

- Scalability
- Security
- Maintainability
- AI-assisted development
- High-performance rendering
- Multi-vendor ecommerce workflow

---

# 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router |
| Language | TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Neon) |
| Styling | Tailwind CSS v4 |
| Authentication | NextAuth.js + JWT |
| Payment | Stripe |
| OTP | Nodemailer |
| File Storage | Cloudflare R2 |
| Deployment | Vercel Pro |
| CDN | Cloudflare |
| Validation | Zod |
| Rate Limiting | Upstash Redis |
| State Management | Zustand |
| Animation | Framer Motion |

---

# 3. Core Architecture Rules

---

## Feature-Based Modular Structure

Each route owns:

- components
- hooks
- actions
- schemas
- server logic

Benefits:
- easier scaling
- cleaner maintenance
- better team collaboration

---

## Route Groups

```bash
(marketing)
(auth)
(dashboard)
````

Purpose:

* separate layouts
* optimized loading
* route isolation
* SEO separation

---

## Private Underscore Folders

```bash
_components/
_hooks/
_actions/
_schemas/
```

Purpose:

* prevent accidental routing
* internal module organization

---

# 4. Full Production Folder Structure

```bash
amar-gadget/
│
├── app/
│   │
│   ├── (marketing)/
│   │   │
│   │   ├── layout.tsx
│   │   ├── loading.tsx
│   │   ├── error.tsx
│   │   ├── not-found.tsx
│   │   ├── page.tsx
│   │   │
│   │   ├── products/
│   │   │   ├── page.tsx
│   │   │   ├── loading.tsx
│   │   │   ├── _components/
│   │   │   ├── _hooks/
│   │   │   ├── _actions/
│   │   │   ├── _schemas/
│   │   │   └── _data.ts
│   │   │
│   │   ├── products/[slug]/
│   │   │   ├── page.tsx
│   │   │   ├── loading.tsx
│   │   │   ├── error.tsx
│   │   │   ├── _components/
│   │   │   ├── _hooks/
│   │   │   ├── _actions/
│   │   │   ├── _schemas/
│   │   │   └── _data.ts
│   │   │
│   │   ├── categories/
│   │   ├── brands/
│   │   ├── deals/
│   │   ├── search/
│   │   ├── cart/
│   │   ├── checkout/
│   │   ├── order-success/
│   │   ├── wishlist/
│   │   ├── compare/
│   │   ├── about/
│   │   ├── contact/
│   │   ├── faq/
│   │   ├── privacy-policy/
│   │   ├── terms/
│   │   └── blog/
│   │
│   ├── (auth)/
│   │   │
│   │   ├── login/
│   │   ├── register/
│   │   ├── verify-email/
│   │   ├── verify-otp/
│   │   ├── forgot-password/
│   │   ├── reset-password/
│   │   └── unauthorized/
│   │
│   ├── (dashboard)/
│   │   │
│   │   ├── admin/
│   │   │   │
│   │   │   ├── analytics/
│   │   │   ├── users/
│   │   │   ├── members/
│   │   │   ├── products/
│   │   │   ├── categories/
│   │   │   ├── brands/
│   │   │   ├── orders/
│   │   │   ├── reviews/
│   │   │   ├── banners/
│   │   │   ├── coupons/
│   │   │   ├── reports/
│   │   │   ├── notifications/
│   │   │   └── settings/
│   │   │
│   │   ├── member/
│   │   │   │
│   │   │   ├── dashboard/
│   │   │   ├── products/
│   │   │   ├── add-product/
│   │   │   ├── orders/
│   │   │   ├── earnings/
│   │   │   ├── payouts/
│   │   │   ├── analytics/
│   │   │   ├── reviews/
│   │   │   └── settings/
│   │   │
│   │   └── user/
│   │       │
│   │       ├── dashboard/
│   │       ├── orders/
│   │       ├── wishlist/
│   │       ├── reviews/
│   │       ├── addresses/
│   │       ├── notifications/
│   │       └── settings/
│   │
│   ├── api/
│   │   │
│   │   ├── auth/
│   │   │   ├── register/
│   │   │   ├── login/
│   │   │   ├── logout/
│   │   │   ├── verify-otp/
│   │   │   ├── resend-otp/
│   │   │   └── forgot-password/
│   │   │
│   │   ├── stripe/
│   │   │   ├── checkout/
│   │   │   ├── webhook/
│   │   │   └── customer-portal/
│   │   │
│   │   ├── products/
│   │   ├── categories/
│   │   ├── brands/
│   │   ├── orders/
│   │   ├── reviews/
│   │   ├── cart/
│   │   ├── upload/
│   │   ├── analytics/
│   │   ├── notifications/
│   │   └── health/
│   │
│   ├── globals.css
│   ├── sitemap.ts
│   ├── robots.ts
│   ├── manifest.ts
│   ├── layout.tsx
│   ├── loading.tsx
│   ├── error.tsx
│   └── not-found.tsx
│
├── components/
│   │
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   ├── modal.tsx
│   │   ├── skeleton.tsx
│   │   ├── toast.tsx
│   │   ├── dropdown.tsx
│   │   ├── table.tsx
│   │   ├── tabs.tsx
│   │   └── pagination.tsx
│   │
│   ├── shared/
│   │   ├── product-card.tsx
│   │   ├── product-grid.tsx
│   │   ├── product-carousel.tsx
│   │   ├── category-card.tsx
│   │   ├── brand-card.tsx
│   │   ├── price.tsx
│   │   ├── rating.tsx
│   │   ├── section-heading.tsx
│   │   └── empty-state.tsx
│   │
│   ├── forms/
│   │   ├── login-form.tsx
│   │   ├── register-form.tsx
│   │   ├── product-form.tsx
│   │   ├── checkout-form.tsx
│   │   └── review-form.tsx
│   │
│   ├── layouts/
│   │   ├── marketing-layout.tsx
│   │   ├── auth-layout.tsx
│   │   └── dashboard-layout.tsx
│   │
│   ├── navbar/
│   ├── footer/
│   ├── modals/
│   ├── providers/
│   └── charts/
│
├── config/
│   ├── site.ts
│   ├── seo.ts
│   ├── navigation.ts
│   ├── dashboard.ts
│   ├── env.ts
│   ├── permissions.ts
│   ├── constants.ts
│   └── security.ts
│
├── constants/
│   ├── roles.ts
│   ├── order-status.ts
│   ├── payment-status.ts
│   └── product-status.ts
│
├── contexts/
│   ├── auth-context.tsx
│   ├── cart-context.tsx
│   └── theme-context.tsx
│
├── hooks/
│   ├── use-auth.ts
│   ├── use-cart.ts
│   ├── use-pagination.ts
│   ├── use-debounce.ts
│   ├── use-media-query.ts
│   └── use-theme.ts
│
├── lib/
│   │
│   ├── prisma.ts
│   ├── auth.ts
│   ├── session.ts
│   ├── redis.ts
│   ├── rate-limit.ts
│   ├── csrf.ts
│   ├── headers.ts
│   ├── permissions.ts
│   ├── slugify.ts
│   ├── formatter.ts
│   ├── pagination.ts
│   ├── upload.ts
│   └── utils.ts
│
│   ├── validations/
│   │   ├── auth.ts
│   │   ├── product.ts
│   │   ├── order.ts
│   │   ├── review.ts
│   │   └── user.ts
│   │
│   ├── stripe/
│   │   ├── stripe.ts
│   │   ├── checkout-session.ts
│   │   ├── payment-intent.ts
│   │   ├── customer.ts
│   │   └── webhook.ts
│   │
│   ├── mail/
│   │   ├── nodemailer.ts
│   │   ├── send-email.ts
│   │   ├── send-otp.ts
│   │   ├── otp-template.ts
│   │   └── templates/
│   │
│   ├── cloudflare/
│   │   ├── r2.ts
│   │   ├── upload-file.ts
│   │   └── delete-file.ts
│   │
│   ├── seo/
│   │   ├── metadata.ts
│   │   ├── schema.ts
│   │   ├── sitemap.ts
│   │   └── breadcrumbs.ts
│   │
│   └── analytics/
│       ├── ga.ts
│       ├── gtm.ts
│       ├── meta-pixel.ts
│       └── web-vitals.ts
│
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   ├── migrations/
│   └── seeds/
│
├── server/
│   │
│   ├── actions/
│   │   ├── auth/
│   │   ├── product/
│   │   ├── order/
│   │   ├── payment/
│   │   └── user/
│   │
│   ├── services/
│   │   ├── auth-service.ts
│   │   ├── product-service.ts
│   │   ├── order-service.ts
│   │   ├── payment-service.ts
│   │   └── otp-service.ts
│   │
│   ├── repositories/
│   │   ├── auth-repository.ts
│   │   ├── product-repository.ts
│   │   ├── order-repository.ts
│   │   └── user-repository.ts
│   │
│   ├── validators/
│   │   ├── auth-validator.ts
│   │   ├── product-validator.ts
│   │   └── order-validator.ts
│   │
│   ├── jobs/
│   │   ├── cleanup-expired-otp.ts
│   │   ├── cleanup-cart.ts
│   │   └── send-reminders.ts
│   │
│   └── emails/
│       ├── verify-email.tsx
│       ├── forgot-password.tsx
│       └── order-confirmation.tsx
│
├── stores/
│   ├── auth-store.ts
│   ├── cart-store.ts
│   ├── modal-store.ts
│   └── checkout-store.ts
│
├── styles/
│   ├── globals.css
│   ├── typography.css
│   ├── animations.css
│   └── utilities.css
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── mocks/
│
├── types/
│   ├── auth.ts
│   ├── user.ts
│   ├── product.ts
│   ├── order.ts
│   ├── api.ts
│   └── global.d.ts
│
├── docs/
│   ├── MD-01-folder-structure.md
│   ├── MD-02-ai-master-prompt.md
│   ├── MD-03-typography-system.md
│   ├── MD-04-seo-analytics.md
│   ├── MD-05-design-system.md
│   ├── prisma-schema.md
│   ├── auth-flow.md
│   ├── payment-flow.md
│   ├── api-architecture.md
│   ├── security-rules.md
│   ├── coding-rules.md
│   ├── deployment-guide.md
│   ├── naming-conventions.md
│   └── ai-development-rules.md
│
├── public/
│   ├── images/
│   ├── icons/
│   ├── logos/
│   ├── manifest/
│   └── favicon.ico
│
├── middleware.ts
├── instrumentation.ts
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
├── eslint.config.js
├── prettier.config.js
├── package.json
└── .env.example
```

---

# 5. Prisma Singleton Setup

## lib/prisma.ts

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

---

# 6. Environment Variables

## .env.example

```env
# Database
DATABASE_URL=
DIRECT_URL=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=
JWT_SECRET=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Nodemailer
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Analytics
NEXT_PUBLIC_GTM_ID=
NEXT_PUBLIC_GA_ID=
```

---

# 7. Security Rules

## Authentication

* JWT stored in httpOnly cookies only
* Never use localStorage
* Secure cookies enabled

---

## Validation

All forms validated:

* server-side
* using Zod
* before database access

---

## Prisma Security

Allowed:

```ts
await prisma.user.findUnique({
  where: { email },
});
```

Blocked:

```ts
prisma.$queryRawUnsafe()
```

---

## API Security

Every API route must:

* validate inputs
* rate limit requests
* check auth
* use explicit CORS allowlist

---

## File Upload Security

Uploads must:

* validate MIME type
* validate size
* upload directly to Cloudflare R2

Never upload to:

```bash
/public
```

---

# 8. Performance Rules

## Use SSR For

* Product details
* SEO pages

## Use ISR For

* Product listing
* Categories

## Use Client Components Only For

* interactive UI
* cart state
* forms

---

# 9. Development Order

## Phase 1

* Next.js setup
* Tailwind setup
* Prisma setup
* PostgreSQL setup

---

## Phase 2

* Authentication
* RBAC
* Dashboard layouts

---

## Phase 3

* Product system
* Upload system
* Approval workflow

---

## Phase 4

* Stripe payments
* Checkout
* Orders
* Webhooks

---

## Phase 5

* SEO
* Analytics
* Security hardening
* Performance optimization

---

# 10. Final Goal

This architecture gives Amar Gadget:

* enterprise scalability
* secure authentication
* production-grade payments
* modular architecture
* AI-friendly development
* multi-vendor support
* SEO optimization
* Bangladesh-ready deployment

```
```
