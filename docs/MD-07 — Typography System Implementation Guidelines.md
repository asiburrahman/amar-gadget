# MD-07 — Typography System Implementation Guidelines

This guide details the step-by-step implementation phases for the complete typography system of Amar Gadget, utilizing Next.js 16 and Tailwind CSS.

---

## Phase 1: Next.js Google Fonts Configuration
Integrate Geist, Inter, and JetBrains Mono with optimized swapping and performance strategies.

### Target File: `app/layout.tsx`
```tsx
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "@/styles/globals.css";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fontInter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontInter.variable} ${fontMono.variable} antialiased`}
    >
      <body className="bg-background text-foreground transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}
```

---

## Phase 2: Tailwind CSS v4 Theme Tokens Setup
Define responsive font size clamps, custom line heights, letter spacing, and semantic fonts.

### Target File: `styles/typography.css`
```css
@theme {
  --font-sans: var(--font-sans), system-ui, sans-serif;
  --font-inter: var(--font-inter), system-ui, sans-serif;
  --font-mono: var(--font-mono), monospace;

  /* Responsive font sizing using fluid CSS clamp */
  --text-xs: clamp(0.75rem, 0.72rem + 0.15vw, 0.8rem);
  --text-sm: clamp(0.875rem, 0.84rem + 0.2vw, 0.95rem);
  --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.1rem);
  --text-lg: clamp(1.125rem, 1.05rem + 0.3vw, 1.25rem);
  --text-xl: clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem);
  --text-2xl: clamp(1.5rem, 1.3rem + 0.8vw, 1.875rem);
  --text-3xl: clamp(1.875rem, 1.6rem + 1vw, 2.25rem);
  --text-4xl: clamp(2.25rem, 2rem + 1.5vw, 3rem);
  --text-5xl: clamp(3rem, 2.5rem + 2vw, 4rem);

  --leading-tight: 1.1;
  --leading-snug: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  --tracking-tight: -0.03em;
  --tracking-normal: 0;
  --tracking-wide: 0.03em;
}
```

---

## Phase 3: Global Accessibility CSS Config
Enforce focus states and support users requesting reduced motion.

### Target File: `styles/globals.css`
```css
@import "./typography.css";

@layer base {
  /* Enforce visible outlines when elements are focused via keyboard */
  *:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  /* Support reduced motion queries */
  @media (prefers-reduced-motion: reduce) {
    *,
    ::before,
    ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

---

## Phase 4: Reusable Semantic Typography Components
Build reusable TSX primitives for standard headers, subheaders, body paragraphs, and labels.

### Target File: `components/ui/typography.tsx`
```tsx
import React from "react";
import { cn } from "@/lib/utils";

interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export function H1({ children, className, ...props }: TypographyProps) {
  return (
    <h1
      className={cn("scroll-m-20 text-4xl font-bold tracking-tight lg:text-5xl font-sans", className)}
      {...props}
    >
      {children}
    </h1>
  );
}

export function H2({ children, className, ...props }: TypographyProps) {
  return (
    <h2
      className={cn(
        "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0 font-sans",
        className
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

export function H3({ children, className, ...props }: TypographyProps) {
  return (
    <h3
      className={cn("scroll-m-20 text-2xl font-semibold tracking-tight font-sans", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function H4({ children, className, ...props }: TypographyProps) {
  return (
    <h4
      className={cn("scroll-m-20 text-xl font-semibold tracking-tight font-sans", className)}
      {...props}
    >
      {children}
    </h4>
  );
}

export function P({ children, className, ...props }: TypographyProps) {
  return (
    <p
      className={cn("leading-relaxed [&:not(:first-child)]:mt-6 font-inter text-base", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function Muted({ children, className, ...props }: TypographyProps) {
  return (
    <span
      className={cn("text-sm text-muted-foreground font-inter", className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function Code({ children, className, ...props }: TypographyProps) {
  return (
    <code
      className={cn(
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
        className
      )}
      {...props}
    >
      {children}
    </code>
  );
}
```

---

## Phase 5: Dark Mode Typography Variable Setup
Ensure colors map cleanly dynamically in both light and dark systems.

### Target File: `styles/theme.css`
```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 47.4% 11.2%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --muted: 210 40% 96.1%;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --muted-foreground: 215 20.2% 65.1%;
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --muted: 217.2 32.6% 17.5%;
}
```

---

## Phase 6: E-commerce Product Typography layout
Implement standard card wrappers respecting multiline clamp ceilings and currency layouts.

### Target File: `components/shared/product-typography-card.tsx`
```tsx
import Image from "next/image";
import { H4, Muted } from "@/components/ui/typography";

interface ProductCardProps {
  title: string;
  price: string;
  discountPrice?: string;
  imageUrl: string;
}

export function ProductTypographyCard({
  title,
  price,
  discountPrice,
  imageUrl,
}: ProductCardProps) {
  return (
    <div className="group relative flex flex-col gap-2 rounded-lg border p-4 bg-card text-card-foreground shadow-sm hover:shadow transition-shadow">
      <div className="aspect-square relative w-full overflow-hidden rounded bg-muted">
        <Image
          src={imageUrl}
          alt={title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <H4 className="line-clamp-2 text-sm font-semibold tracking-tight min-h-[2.5rem]">
        {title}
      </H4>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-tight text-primary font-sans">
          {price} BDT
        </span>
        {discountPrice && (
          <span className="text-xs line-through text-muted-foreground font-sans">
            {discountPrice} BDT
          </span>
        )}
      </div>
    </div>
  );
}
```

---

## Phase 7: Dashboard Numeric Card Components
Design high-density numeric display components using monospace styling to optimize info scanning.

### Target File: `components/dashboard/stat-numeric-card.tsx`
```tsx
import { H3, Muted } from "@/components/ui/typography";

interface StatProps {
  title: string;
  value: string;
  change: string;
  isPositive: boolean;
}

export function StatNumericCard({ title, value, change, isPositive }: StatProps) {
  return (
    <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <Muted className="text-xs font-medium uppercase tracking-wider">{title}</Muted>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight font-mono leading-none">
          {value}
        </span>
        <span
          className={`text-xs font-semibold font-sans ${
            isPositive ? "text-green-600" : "text-red-600"
          }`}
        >
          {isPositive ? "+" : ""}
          {change}
        </span>
      </div>
    </div>
  );
}
```

---

## Phase 8: Form Controls and Interactive Labels
Create inputs with correct responsive typography tags.

### Target File: `components/shared/form-input.tsx`
```tsx
import React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FormInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <label
          htmlFor={id}
          className="text-sm font-medium tracking-wide text-foreground font-sans cursor-pointer"
        >
          {label}
        </label>
        <input
          id={id}
          ref={ref}
          className={cn(
            "flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-inter",
            error ? "border-red-500" : "border-input",
            className
          )}
          {...props}
        />
        {error && (
          <span className="text-xs font-semibold text-red-500 font-sans">
            {error}
          </span>
        )}
      </div>
    );
  }
);
FormInput.displayName = "FormInput";
```

---

## Phase 9: Single-H1 Semantic Guard Checker
Enforce that client page layouts always maintain a clean heading hierarchy to maximize SEO indexes.

### Target File: `components/shared/seo-guard.tsx`
```tsx
"use client";

import React, { useEffect } from "react";

interface SEOGuardProps {
  children: React.ReactNode;
}

export function SEOGuard({ children }: SEOGuardProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      const h1Count = document.querySelectorAll("h1").length;
      if (h1Count > 1) {
        console.warn(
          `⚠️ SEO Warning: Found ${h1Count} H1 elements on this page. Search engines prefer exactly 1 H1 element per page.`
        );
      }
    }
  }, []);

  return <>{children}</>;
}
```

---

## Phase 10: Typography Unit Performance Checks
Assert correct CSS custom properties are resolved at runtime in Jest.

### Target File: `tests/unit/typography.test.ts`
```typescript
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { H1, Code } from "../../components/ui/typography";

describe("Typography Component Suite", () => {
  it("renders H1 element with proper styling classes", () => {
    render(<H1>Amar Gadget Title</H1>);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-4xl");
    expect(heading).toHaveClass("font-bold");
  });

  it("renders monospace Code element with custom tokens", () => {
    render(<Code>ORDER-12345</Code>);
    const codeSnippet = screen.getByText("ORDER-12345");
    expect(codeSnippet.tagName).toBe("CODE");
    expect(codeSnippet).toHaveClass("font-mono");
    expect(codeSnippet).toHaveClass("text-sm");
  });
});
```
