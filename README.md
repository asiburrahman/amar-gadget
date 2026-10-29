# 🛍️ Amar Gadget (আমার গ্যাজেট)

> **A Next-Gen, Full-Stack Multi-Vendor E-Commerce Marketplace**
> *Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Prisma, PostgreSQL (Neon), Stripe, Cloudflare R2, and Upstash Redis.*

[![Next.js](https://img.shields.io/badge/Next.js-16.4.3-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.9-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.10.1-2d3748?style=for-the-badge&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon_Serverless-4169e1?style=for-the-badge&logo=postgresql)](https://neon.tech/)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635bff?style=for-the-badge&logo=stripe)](https://stripe.com/)
[![Cloudflare R2](https://img.shields.io/badge/Storage-Cloudflare_R2-f38020?style=for-the-badge&logo=cloudflare)](https://www.cloudflare.com/products/r2/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](./LICENSE)

---

### 📌 Quick Repository Information
- **Repository Description (GitHub About)**:
  `A high-performance, production-ready multi-vendor e-commerce marketplace built with Next.js 16 App Router, Prisma ORM, Neon PostgreSQL, Stripe, Cloudflare R2, and Role-Based Access Control (Admin, Seller, Customer).`
- **বাংলা সারসংক্ষেপ**:
  `আমার গ্যাজেট (Amar Gadget) একটি আধুনিক মাল্টি-ভেন্ডর ই-কমার্স প্ল্যাটফর্ম। এতে রয়েছে অ্যাডমিন, মার্চেন্ট/সেলার এবং কাস্টমারদের জন্য পৃথক ড্যাশবোর্ড, স্ট্রাইপ ও ক্যাশ অন ডেলিভারি পেমেন্ট, ইমেইল ওটিপি ভেরিফিকেশন, এবং ক্লাউডফ্লেয়ার R2 ইমেজ স্টোরেজ।`

---

## 📑 Table of Contents
- [🎯 Project Purpose & Mission](#-project-purpose--mission)
- [🌐 Live Demo & Deployment](#-live-demo--deployment)
- [✨ Key Features](#-key-features)
  - [👑 Admin Capabilities](#-admin-capabilities)
  - [🏪 Member / Seller Capabilities](#-member--seller-capabilities)
  - [🛒 Customer / User Experience](#-customer--user-experience)
  - [🛡️ Security & Performance](#️-security--performance)
- [🏗️ System Architecture & Tech Stack](#️-system-architecture--tech-stack)
- [📁 Folder Structure](#-folder-structure)
- [🚀 Local Development Setup](#-local-development-setup)
  - [Prerequisites](#prerequisites)
  - [Installation Steps](#installation-steps)
  - [Environment Configuration (`.env`)](#environment-configuration-env)
  - [Database Migration & Seeding](#database-migration--seeding)
  - [Running the Application](#running-the-application)
- [🐳 Docker & Production Deployment](#-docker--production-deployment)
- [🧪 Testing & Linting](#-testing--linting)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## 🎯 Project Purpose & Mission

**Amar Gadget (আমার গ্যাজেট)** was engineered to solve the real-world scalability, security, and developer ergonomics challenges of building modern e-commerce marketplaces in South Asia and global markets.

Unlike conventional monolithic single-vendor stores, **Amar Gadget** provides:
1. **Multi-Vendor Ecosystem**: Independent vendor onboarding with strict **Admin approval gates** to ensure high-quality product listings.
2. **True Role-Based Architecture (RBAC)**: Distinct layouts, permissions, and server-side route guards for **Admins**, **Sellers/Members**, and **Customers**.
3. **Blazing Fast Modern Web Stack**: Leveraging **Next.js 16 App Router**, **React 19 Server Components (RSC)**, streaming layouts, and **Tailwind CSS v4** for sub-second page transitions.
4. **Reliable Infrastructure**: Serverless PostgreSQL via **Neon Database**, high-speed blob storage with **Cloudflare R2 (S3-compatible)**, rate-limiting via **Upstash Redis**, and resilient payments with **Stripe + COD**.

---

## 🌐 Live Demo & Deployment

- **Live URL**: [https://amargadget.gmksolution.com](https://amargadget.gmksolution.com) *(or local Cloudflare Tunnel)*
- **Demo Accounts for Testing**:

| Role | Email | Password | Access Area |
| :--- | :--- | :--- | :--- |
| **Admin** | Configure a local seed account | Never publish credentials | `/admin` |
| **Seller / Member** | Configure a local seed account | Never publish credentials | `/member` |
| **Customer** | Register a local account | Never publish credentials | `/user` & Storefront |

---

## ✨ Key Features

### 👑 Admin Capabilities
- **Product Approval Workflow**: Review, approve, or reject vendor-submitted products before they appear in public listings.
- **Vendor Moderation**: Approve, review, or suspend vendor accounts.
- **Global Order Management**: Live tracking of orders across all vendors, update shipment status, and monitor fulfillment.
- **Category & Brand Management**: Dynamic CRUD for product categories, subcategories, brand logos, and metadata.
- **Promotional Engine**: Manage discount coupons (percentage & fixed amount) and home page hero banners.
- **Comprehensive Analytics**: Monitor total volume, sales revenue, active users, and platform growth.

### 🏪 Member / Seller Capabilities
- **Vendor Portal**: Dedicated clean dashboard for store management.
- **Inventory & Product Creation**: Add products with multi-image gallery upload (Cloudflare R2), markdown descriptions, pricing, discounts, and inventory counts.
- **Sales & Earnings Overview**: Track product sales, revenue, and active order statuses.
- **Order Processing**: Review order items belonging strictly to the seller's catalog and update packaging status.

### 🛒 Customer / User Experience
- **Interactive Storefront**: Hero carousels, featured product grids, flash deals, categories, and brand showcases.
- **Advanced Search & Filtering**: Multi-faceted filtering by category, brand, price slider, and sorting.
- **Product Comparison**: Side-by-side technical specs and price comparison between gadgets.
- **Cart & Wishlist**: Persistent cart state (powered by Zustand) and personal wishlist sync.
- **Seamless Checkout**: Address management with default shipping destinations and checkout summary with coupon code redemption.
- **Payment Flexibility**: Credit/Debit cards via **Stripe Checkout** + **Cash on Delivery (COD)**.
- **Order Tracking**: Real-time status tracker (`PENDING` → `PROCESSING` → `SHIPPED` → `DELIVERED`).
- **Product Reviews & Ratings**: Verified customer reviews with star ratings and feedback.

### 🛡️ Security & Performance
- **Authentication**: Custom JWT authentication (`jose`) with secure HTTP-only cookies and versioned scrypt password hashes; compatible legacy hashes are upgraded on successful login.
- **Email OTP Verification**: Two-step account verification and password reset workflows powered by **Nodemailer**.
- **Rate Limiting**: Distributed rate-limiting via **Upstash Redis** to protect authentication endpoints and sensitive APIs against brute-force attacks.
- **Schema Validation**: End-to-end data validation using **Zod** for all client forms and backend server actions/routes.
- **Data Protection**: Strict row-level data isolation ensuring users and vendors can never view or manipulate unauthorized data.
- **Asset Optimization**: Responsive image compression and delivery via Next.js Image Optimization and Cloudflare CDN.

---

## 🏗️ System Architecture & Tech Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    Amar Gadget Architecture                     │
└─────────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   Next.js 16 App Router                Cloudflare Edge / CDN
   (RSC, Route Groups, Actions)         (Assets & Media Caching)
            │
            ├───────────────┬───────────────┬───────────────┐
            ▼               ▼               ▼               ▼
      PostgreSQL         Stripe       Cloudflare R2   Upstash Redis
     (Neon DB via       (Payment       (Product &     (Rate Limiting &
      Prisma ORM)       Webhooks)      User Media)      Token Cache)
```

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Framework** | **Next.js 16 (App Router)** | Hybrid SSG/SSR, Server Components, Server Actions |
| **Frontend Library** | **React 19** | Latest React features, concurrent rendering |
| **Language** | **TypeScript 5.x** | Complete end-to-end type safety |
| **Styling** | **Tailwind CSS v4** | Next-gen CSS-first styling engine |
| **ORM & Database** | **Prisma 7.10.1 + Neon PostgreSQL** | PostgreSQL via the transaction-capable PrismaPg adapter |
| **Payments** | **Stripe API & Webhooks** | Card processing and automated payment status webhooks |
| **File Storage** | **Cloudflare R2 (AWS S3 SDK)** | High-throughput, zero-egress cost object storage |
| **Rate Limiter** | **Upstash Redis** | Sliding-window API rate limiting |
| **Email & OTP** | **Nodemailer** | SMTP email delivery with secure OTP tokens |
| **State Management** | **Zustand** | Lightweight, reactive client-side store for Cart & Wishlist |
| **Validation** | **Zod** | Strict runtime schema parsing for forms and API routes |

---

## 📁 Folder Structure

The project follows a feature-based, modular structure organized with Next.js 16 Route Groups:

```text
amar-gadget/
├── app/
│   ├── (auth)/                 # Authentication routes (Login, Register, OTP, Password Reset)
│   ├── (dashboard)/            # Protected role-based dashboards
│   │   ├── admin/              # Admin management panel
│   │   ├── member/             # Seller / Vendor management panel
│   │   └── user/               # Customer account & order history
│   ├── (marketing)/            # Public storefront routes
│   │   ├── cart/               # Shopping cart
│   │   ├── checkout/           # Multi-step checkout
│   │   ├── compare/            # Product specification comparison
│   │   ├── products/           # Product listing & details page
│   │   ├── track-order/        # Order tracking portal
│   │   └── ...                 # Brands, Categories, Deals, Wishlist, About, FAQ
│   ├── api/                    # RESTful endpoints & Webhook handlers
│   │   ├── auth/               # Login, register, logout, OTP handlers
│   │   ├── products/           # Catalog APIs
│   │   ├── orders/             # Order fulfillment APIs
│   │   ├── upload/             # Cloudflare R2 Presigned upload URLs
│   │   └── webhooks/           # Stripe payment webhooks
│   ├── layout.tsx              # Root HTML & typography layout
│   └── globals.css             # Tailwind CSS v4 design tokens
├── components/                 # Shared UI components (Modals, Buttons, Forms, Topbar)
├── config/                     # Application configurations (site, seo, navigation)
├── docs/                       # Architectural & system specification docs
├── lib/                        # Shared utilities (prisma, auth, formatters, storage)
├── prisma/
│   ├── schema.prisma           # Relational schema (User, Product, Order, Category, etc.)
│   └── migrations/             # Database migration history
├── public/                     # Static assets, icons, and SVG illustrations
├── stores/                     # Zustand state stores (Cart, Wishlist, Filters)
├── types/                      # Global TypeScript definitions
├── Dockerfile                  # Production container definition
├── seed.js                     # Seed script for initial categories, brands, & products
└── package.json
```

---

## 🚀 Local Development Setup

Follow these steps to run **Amar Gadget** locally on your machine:

### Prerequisites
- **Node.js**: `v22.x` (22.12+) or `v24.x`; local validation uses 24.19.0. The package engine range also permits Node 20.19+.
- **Package Manager**: `npm`, `pnpm`, or `bun`
- **Database**: A PostgreSQL instance (e.g. Free [Neon](https://neon.tech), Supabase, or local PostgreSQL)

---

### Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/asiburrahman/amar-gadget.git
   cd amar-gadget
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory by copying the example:
   ```bash
   cp .env.example .env
   ```

---

### Environment Configuration (`.env`)

Fill in the required credentials in your `.env` file:

```env
# Database (Neon Serverless PostgreSQL or local PostgreSQL)
DATABASE_URL="postgresql://user:password@ep-sample.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:password@ep-sample.neon.tech/neondb?sslmode=require"

# JWT Authentication
# Generate distinct private keys (at least 32 random bytes each).
JWT_SECRET=""
OTP_SECRET=""
TRUSTED_PROXY_SECRET=""
APP_URL="http://localhost:3000"

# Nodemailer / SMTP (For OTP and password reset emails)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="Amar Gadget <noreply@amargadget.com>"

# Cloudflare R2 / AWS S3 (For image & media uploads)
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET_NAME="amar-gadget"
R2_PUBLIC_URL="https://pub-xxxxxx.r2.dev"

# Stripe Payments
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
CHECKOUT_SWEEP_SECRET=""
CHECKOUT_SWEEP_DATABASE="your-database-name"

# Upstash Redis (For distributed rate limiting)
UPSTASH_REDIS_REST_URL="https://your-upstash-redis.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-upstash-redis-token"

# Analytics (Optional)
NEXT_PUBLIC_GA_ID="G-XXXXXXXXXX"
NEXT_PUBLIC_GTM_ID="GTM-XXXXXXX"
```

Runtime settings are validated before the supported production launcher starts listening. `APP_URL` is the server's canonical checkout origin; public HTTPS is required, with HTTP allowed only for loopback testing. JWT, OTP, trusted-ingress and reservation-worker keys must be distinct private values of at least 32 bytes. Production also requires `TRUSTED_PROXY_SECRET` and the private gateway described in the [trusted ingress runbook](docs/TRUSTED_INGRESS_RUNBOOK.md). NextAuth/OAuth credentials and a Stripe publishable key are not required by the implemented custom authentication/hosted Checkout flows.

Production requires complete Redis, SMTP, Stripe/reservation-worker and R2 settings. Development requires the database, keys and application origin; any enabled service group must be complete. Builds remove dotenv files from the standalone artifact and copy its public/static assets. Deploy with runtime environment injection and run `node start.cjs` from that artifact; `npm start` uses the same launcher and can explicitly load a private workspace `.env`. `SKIP_ENV_VALIDATION` does not bypass runtime checks. Use `/api/health` for process liveness and `/api/health/ready` for configured database/schema/Redis readiness. See the [runtime configuration runbook](docs/RUNTIME_CONFIGURATION_RUNBOOK.md).

Product images upload directly to R2 with progress/retry and a saved cover/gallery; file bytes are not posted through Server Actions or stored as base64. Configure the bucket's exact-origin CORS and public domain using the [product-image runbook](docs/PRODUCT_IMAGES_RUNBOOK.md), which also documents dry-run unused-upload cleanup and the live bucket/browser release checks.

Brand collections use real database slugs/counts and consistent `brand`/`brandId` filters across page, action and API. Unknown brands show an explicit empty state. See the [brand-filter contract and verification](docs/BRAND_FILTERS_RUNBOOK.md).

---

### Database Migration & Seeding

The application and seed use the transaction-capable PostgreSQL TCP adapter (`@prisma/adapter-pg`). For Neon, use its pooled TCP URL for `DATABASE_URL` and direct TCP URL for `DIRECT_URL`; the Prisma CLI prefers `DIRECT_URL` when present. Ordinary local PostgreSQL TCP URLs also work. HTTP-only database connections are unsuitable for the checkout and OTP transactions.

1. **Apply migrations to a fresh local development database and generate the Prisma client**:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

2. **Seed sample categories and brands**:
   ```bash
   npx prisma db seed
   ```

The seed command does not create default login accounts or products. Register a local customer or seller account through the application; seller accounts require administrator approval. Admin accounts must be provisioned privately by the operator. This repository intentionally does not publish demo passwords. If a database was previously created with `prisma db push`, review its migration state before using `prisma migrate deploy`; do not run migrations against a production database without a backup and an approved rollout plan.

---

### Running the Application

Start the Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Optional: Cloudflare Tunnel for Remote / Mobile Testing**
> Configure a named tunnel and the private gateway for the exact `APP_URL` hostname as described in the [ingress runbook](docs/TRUSTED_INGRESS_RUNBOOK.md), then start your configured tunnel:
> ```bash
> npm run tunnel:local
> ```

---

## 🐳 Docker & Production Deployment

### Build and Run with Docker
The repository includes an optimized multi-stage `Dockerfile`:

```bash
# 1. Build the Docker image
docker build -t amar-gadget:latest .

# 2. Run the container
docker run -p 127.0.0.1:3000:3000 --env-file .env amar-gadget:latest
```

Production application traffic must pass through the configured private ingress gateway and named tunnel. The container's loopback mapping is the private backend, not a public storefront endpoint. Follow the [ingress deployment steps](docs/TRUSTED_INGRESS_RUNBOOK.md) before exposing the hostname.

### Production Build
To create an optimized production build directly:

```bash
npm run build
npm run start
```

---

## 🧪 Testing & Linting

```bash
# Run unit & integration tests
npm run test

# Run ESLint validation
npm run lint
```

### Deep Audit & Open Tasks (28 October 2026)

[Read the Codex-assisted deep audit and prioritized task list](docs/DEEP_AUDIT_2026-10-28.md). It records source evidence, acceptance criteria, current validation results, and incomplete frontend/backend wiring. The separate `codex/deep-audit-2026-10-28` branch contains this audit contribution; its task list does not imply the listed fixes have been implemented.

[Implementation progress and validation evidence](docs/CODEX_IMPLEMENTATION_LOG.md) tracks fixes against the original audit. [The first technical case study](docs/CODEX_CONTENT_CASE_STUDY.md) explains the transaction blocker, security fixes, and reproducible checks.

[The implementation sequence](docs/IMPLEMENTATION_SCHEDULE.md) covers every remaining task with completion rules and the next checkpoint.

[Catalog filtering and pagination contracts](docs/CATALOG_FILTERS_RUNBOOK.md) document the shared page/API/action queries, searchable brand/category choices and paid-delivered sales ranking implemented in AUD-019. Current implementation progress and remaining release checks are recorded in the implementation log.

[Search and comparison contracts](docs/SEARCH_COMPARISON_RUNBOOK.md) cover the working header/search destination, four-product shareable selection and seller-supplied specifications persisted by AUD-020. This revision requires migration `20261029100000_product_specifications` before deployment; no technical data is invented for existing products.

[Campaigns, browser history and BDT pricing](docs/CAMPAIGNS_HISTORY_CURRENCY_RUNBOOK.md) document AUD-037's database-backed campaign management, real recently viewed products, current catalog offer policy and fixed checkout currency. Apply migration `20261029110000_catalog_campaigns` before deploying this revision. Campaign listing expiry does not change an independently configured product discount.

[Canonical origin, sitemap and structured-data contracts](docs/SEO_RUNBOOK.md) document AUD-043. APP_URL supplies runtime SEO URLs; `/sitemap.xml` indexes bounded public-catalog/taxonomy files. `npm run smoke:seo` verifies actual prepared-server HTML/XML/headers under two runtime origins. Metadata is request-time, so the runbook also records the effect on formerly static pages.

### Codex-Assisted Development Record

This change was made after reviewing authorization boundaries, checkout totals and payment state, catalog visibility, OTP handling, order tracking, and the checked-in Prisma migrations. The main engineering decision was to derive identities and prices on the server, then make payment confirmation depend on a verified Stripe webhook rather than client input.

Reproduce the local checks with:

```bash
npm test -- --runInBand
npx tsc --noEmit
npx prisma validate
node --check prisma/seeds/seed.js
git diff --check
```

**Recorded results for this change:** 4 Jest suites and 17 tests passed; TypeScript passed; Prisma schema validation passed; the seed script syntax check passed; and `git diff --check` passed. ESLint on changed TypeScript files did not pass (23 errors and 14 warnings, including pre-existing lint issues; the earlier repository-wide audit recorded 123 errors and 79 warnings). The production build, live Stripe flow, browser walkthrough, and database migration were not run. The migration has not been applied to any database.

For portfolio evidence, capture a local before/after checkout and role-access walkthrough after configuring test-only services and a disposable database. Do not use production credentials or data. No screenshots, user metrics, or live payment results are included in this repository.

---

## 🤝 Contributing

Contributions make the open-source community an inspiring place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project (`https://github.com/asiburrahman/amar-gadget/fork`)
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  Crafted with ❤️ by <a href="https://github.com/asiburrahman">Asibur Rahman</a> & the Amar Gadget Team.
</p>
