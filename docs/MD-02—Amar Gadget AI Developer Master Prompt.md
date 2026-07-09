# MD-02 — Amar Gadget AI Developer Master Prompt

````md
# MD-02 — Amar Gadget AI Developer Master Prompt
## Production AI Instruction System
### Next.js 16 + Prisma + PostgreSQL + Stripe + Nodemailer + Cloudflare R2

---

# 1. PROJECT OVERVIEW

You are building a production-grade multi-vendor ecommerce platform named:

# Amar Gadget

The platform supports:

- Admin role
- Member/Seller role
- User/Customer role

This is a modern scalable ecommerce marketplace similar to:
- Daraz
- Amazon Marketplace
- Pickaboo

The project must be:
- scalable
- secure
- SEO optimized
- production ready
- mobile responsive
- AI maintainable

---

# 2. CORE BUSINESS LOGIC

---

## Admin

Admin can:
- manage users
- manage members/sellers
- approve/reject products
- manage orders
- manage reviews
- manage categories
- manage banners
- manage analytics
- manage coupons
- manage reports

---

## Member / Seller

Members can:
- create products
- edit products
- manage inventory
- view orders
- track earnings
- request payouts

IMPORTANT:
Products created by members MUST require admin approval before publishing.

---

## User / Customer

Users can:
- browse products
- add to cart
- buy products
- review products
- manage profile
- track orders

---

# 3. TECH STACK

| Layer | Technology |
|---|---|
| Framework | Next.js 16 App Router |
| Language | TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Neon) |
| Styling | Tailwind CSS v4 |
| Authentication | NextAuth.js v5 |
| JWT | jose |
| Validation | Zod |
| Payments | Stripe |
| OTP | Nodemailer |
| Storage | Cloudflare R2 |
| CDN | Cloudflare |
| Deployment | Vercel Pro |
| State Management | Zustand |
| Animation | Framer Motion |
| Rate Limiting | Upstash Redis |

---

# 4. PROJECT ARCHITECTURE RULES

---

## MUST USE FEATURE-BASED STRUCTURE

Every route owns:
- components
- actions
- hooks
- validation
- local data

Example:

```bash
products/[slug]/
````

Contains:

```bash
_components/
_hooks/
_actions/
_schemas/
_data.ts
```

---

## ROUTE GROUPS REQUIRED

```bash
(marketing)
(auth)
(dashboard)
```

Purpose:

* separate layouts
* optimized loading
* route isolation
* SEO organization

---

## PRIVATE FOLDERS

Folders prefixed with `_` are private:

```bash
_components/
_hooks/
_actions/
_schemas/
```

Never expose these as routes.

---

# 5. FOLDER STRUCTURE RULES

Follow MD-01 architecture strictly.

NEVER:

* create giant shared folders
* mix dashboard logic with marketing logic
* place business logic inside components
* place Prisma queries inside UI files

ALWAYS:

* separate concerns
* colocate features
* isolate payment logic
* isolate auth logic

---

# 6. TYPESCRIPT RULES

---

## STRICT MODE REQUIRED

Enable:

```json
"strict": true
```

---

## NEVER USE

```ts
any
```

Use:

* interfaces
* types
* generics

---

## ALWAYS TYPE

* API responses
* props
* hooks
* Prisma outputs
* server actions

---

# 7. COMPONENT RULES

---

## SERVER COMPONENTS FIRST

Default:

```tsx
Server Components
```

Only use:

```tsx
"use client"
```

when required.

---

## CLIENT COMPONENTS ALLOWED FOR

* forms
* animations
* cart state
* interactive UI
* local browser state

---

## COMPONENT NAMING

GOOD:

```bash
product-card.tsx
```

BAD:

```bash
ProductCardComponent.tsx
```

---

# 8. STYLING RULES

---

## USE ONLY

* Tailwind CSS v4
* clsx
* tailwind-merge

---

## NEVER USE

* inline styles
* CSS modules
* styled-components

---

## DESIGN SYSTEM REQUIRED

Use semantic tokens:

* primary
* secondary
* destructive
* muted
* accent

Must support:

* dark mode
* responsive layouts
* accessibility

---

# 9. SECURITY RULES

CRITICAL:
Security is mandatory across the entire project.

---

# AUTH RULES

JWT MUST:

* use httpOnly cookies
* use secure cookies
* use sameSite=lax

NEVER:

* store JWT in localStorage
* expose tokens client-side

---

# VALIDATION RULES

Every:

* form
* API route
* server action

MUST validate inputs using:

```ts
Zod
```

before touching database.

---

# DATABASE RULES

ONLY USE:

```ts
Prisma ORM
```

ALWAYS:

* use parameterized Prisma queries
* sanitize user input

---

# FORBIDDEN

```ts
$queryRawUnsafe
```

Block via ESLint.

---

# RATE LIMITING

Every API route MUST use:

* Upstash Redis
* middleware rate limiting

Especially:

* auth routes
* OTP routes
* checkout routes
* review routes

---

# CSRF PROTECTION

Required for:

* forms
* checkout
* auth actions

---

# HEADERS REQUIRED

Configure in:

```ts
next.config.ts
```

Required headers:

* Content-Security-Policy
* X-Frame-Options
* X-Content-Type-Options
* Referrer-Policy

---

# FILE UPLOAD SECURITY

Uploads MUST:

* validate MIME type
* validate file size
* upload to Cloudflare R2
* never use `/public`

---

# ENVIRONMENT RULES

Only expose:

```env
NEXT_PUBLIC_
```

for truly public variables.

---

# 10. DATABASE DESIGN RULES

Core models required:

* User
* Product
* Category
* Brand
* Order
* Review
* Cart
* Wishlist
* OTPVerification

---

# ROLE ENUM

```prisma
enum Role {
  ADMIN
  MEMBER
  USER
}
```

---

# PRODUCT STATUS ENUM

```prisma
enum ProductStatus {
  PENDING
  APPROVED
  REJECTED
  DRAFT
}
```

---

# ORDER STATUS ENUM

```prisma
enum OrderStatus {
  PENDING
  PAID
  PROCESSING
  SHIPPED
  DELIVERED
  CANCELLED
  REFUNDED
}
```

---

# 11. PAYMENT RULES

Use:

```ts
Stripe
```

---

# STRIPE FLOW

1. User clicks checkout
2. Server action creates Stripe session
3. Redirect to Stripe Checkout
4. Stripe handles payment
5. Webhook verifies payment
6. Order updated server-side

---

# NEVER TRUST FRONTEND PAYMENT STATE

Always verify using:

```ts
stripe.webhooks.constructEvent()
```

---

# 12. OTP SYSTEM RULES

Use:

```ts
Nodemailer
```

OTP flow:

1. generate OTP
2. hash OTP
3. store securely
4. send email
5. verify server-side

---

# OTP SECURITY

OTP must:

* expire in 2 minutes
* max 5 attempts
* never store plain text OTP

---

# 13. SEO RULES

Every route MUST support:

* generateMetadata()
* canonical URLs
* Open Graph
* Twitter metadata
* structured data

---

# REQUIRED JSON-LD

* Organization
* Product
* BreadcrumbList
* FAQPage
* Article

---

# REQUIRED FILES

```bash
sitemap.ts
robots.ts
manifest.ts
```

---

# 14. PERFORMANCE RULES

---

# IMAGE RULES

Use:

```tsx
next/image
```

Always:

* WebP/AVIF
* lazy loading
* responsive sizes
* blur placeholders

---

# RENDERING STRATEGY

## SSR FOR

* product details
* SEO pages

## ISR FOR

* category pages
* product listing pages

## CLIENT COMPONENTS ONLY FOR

* forms
* cart
* interactions

---

# 15. ANALYTICS RULES

Implement:

* Google Tag Manager
* GA4
* Meta Pixel
* Conversion tracking

NEVER:

* send PII
* track without consent

---

# 16. ACCESSIBILITY RULES

Required:

* keyboard navigation
* focus-visible states
* aria labels
* reduced motion support
* semantic HTML

Minimum:

* WCAG AA compliance

---

# 17. API RULES

All API handlers MUST:

* validate with Zod
* authenticate requests
* rate limit
* return typed responses
* use explicit CORS allowlist

---

# 18. SERVER ACTION RULES

Use Server Actions for:

* forms
* secure mutations
* checkout
* dashboard actions

NEVER use Server Actions for:

* public GET APIs
* large uploads
* cron jobs

---

# 19. LOGGING & MONITORING

Implement:

* Sentry
* Vercel Analytics
* error logging

Track:

* payment failures
* auth failures
* API failures

---

# 20. TESTING RULES

Use:

* Vitest
* Playwright

Test:

* auth flow
* checkout flow
* dashboard permissions
* API validation

---

# 21. CODE QUALITY RULES

Required:

* ESLint
* Prettier
* strict TypeScript
* no unused imports

---

# FORBIDDEN PATTERNS

NEVER:

* use inline styles
* use unsafe raw SQL
* use localStorage auth
* hardcode secrets
* mix server/client logic improperly
* duplicate business logic

---

# 22. DEPLOYMENT RULES

Deployment target:

* Vercel Pro

Database:

* Neon PostgreSQL

Storage:

* Cloudflare R2

CDN:

* Cloudflare

---

# REGIONS

Prefer:

* Singapore region
* nearest Asia edge locations

---

# 23. AI CODING RULES

When generating code:

ALWAYS:

* generate production-ready code
* generate typed code
* include loading/error states
* include accessibility
* include validation
* include security

NEVER:

* generate placeholder implementations
* generate incomplete handlers
* skip validation
* skip typing

---

# 24. FINAL GOAL

The final result must be:

* scalable
* enterprise-grade
* secure
* maintainable
* SEO optimized
* mobile responsive
* multi-vendor ready
* AI-maintainable
* production deployable

The architecture must support future additions:

* Bangladesh payment gateways
* mobile apps
* affiliate system
* loyalty system
* AI recommendations
* multi-language support

```
```
