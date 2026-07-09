# MD-03 — Amar Gadget Typography System

````md id="kfq1mx"
# MD-03 — Amar Gadget Typography System
## Production Typography Architecture
### Next.js 16 + Tailwind CSS v4

---

# 1. Typography Goals

The typography system for Amar Gadget must provide:

- readability
- visual hierarchy
- accessibility
- responsive scaling
- ecommerce clarity
- dashboard usability
- SEO-friendly semantic structure

This system is optimized for:
- ecommerce product browsing
- dashboards
- forms
- mobile-first UX
- Bangladesh internet/mobile usage patterns

---

# 2. Font Strategy

---

# Primary Font

Use:

```tsx id="phkl6i"
Geist
````

Reason:

* modern
* optimized for Next.js
* excellent readability
* high performance
* variable font support

---

# Secondary Font

Use:

```tsx id="vtkg8n"
Inter
```

Fallback for:

* UI consistency
* dashboard readability

---

# Monospace Font

Use:

```tsx id="df9fxv"
JetBrains Mono
```

Used for:

* order IDs
* OTP codes
* admin logs
* developer/debug areas

---

# 3. Next.js Font Setup

## app/layout.tsx

```tsx id="91rd4s"
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
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
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
```

---

# 4. Tailwind v4 Typography Tokens

## styles/typography.css

```css id="zwc55v"
@theme {
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);

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

# 5. Responsive Typography Scale

| Token     | Mobile | Desktop | Usage             |
| --------- | ------ | ------- | ----------------- |
| text-xs   | 12px   | 13px    | labels            |
| text-sm   | 14px   | 15px    | captions          |
| text-base | 16px   | 18px    | body text         |
| text-lg   | 18px   | 20px    | large body        |
| text-xl   | 20px   | 24px    | section titles    |
| text-2xl  | 24px   | 30px    | page titles       |
| text-3xl  | 30px   | 36px    | hero sections     |
| text-4xl  | 36px   | 48px    | landing hero      |
| text-5xl  | 48px   | 64px    | marketing banners |

---

# 6. Font Weight System

| Weight    | Value | Usage          |
| --------- | ----- | -------------- |
| Light     | 300   | rare marketing |
| Regular   | 400   | paragraphs     |
| Medium    | 500   | navigation     |
| Semibold  | 600   | buttons        |
| Bold      | 700   | headings       |
| Extrabold | 800   | hero text      |

---

# 7. Line Height System

| Token   | Value | Usage        |
| ------- | ----- | ------------ |
| tight   | 1.1   | hero         |
| snug    | 1.25  | headings     |
| normal  | 1.5   | paragraphs   |
| relaxed | 1.75  | long content |

---

# 8. Letter Spacing Rules

| Token           | Usage          |
| --------------- | -------------- |
| tracking-tight  | headings       |
| tracking-normal | body           |
| tracking-wide   | labels/buttons |

---

# 9. Semantic Typography Classes

## Heading Styles

```tsx id="6j5f9j"
<h1 className="text-4xl font-bold tracking-tight">
```

```tsx id="8k1q6m"
<h2 className="text-3xl font-semibold tracking-tight">
```

```tsx id="x0f8fr"
<h3 className="text-2xl font-semibold">
```

---

# Body Text

```tsx id="83fxgn"
<p className="text-base leading-relaxed text-muted-foreground">
```

---

# Product Price

```tsx id="p4b0hx"
<span className="text-xl font-bold text-primary">
```

---

# Product Description

```tsx id="0x4m8h"
<p className="text-sm leading-relaxed">
```

---

# Dashboard Labels

```tsx id="b50lwl"
<label className="text-sm font-medium">
```

---

# 10. Ecommerce Typography Rules

---

# Product Title

Must:

* maximum 2 lines
* semibold
* readable on mobile

Example:

```tsx id="gxmk1x"
<h3 className="line-clamp-2 text-base font-semibold">
```

---

# Product Price

Rules:

* high contrast
* bold
* visually dominant

Example:

```tsx id="93mw4g"
<span className="text-lg font-bold text-primary">
```

---

# Discount Price

Example:

```tsx id="m3t7kh"
<span className="text-sm line-through text-muted-foreground">
```

---

# 11. Dashboard Typography Rules

Dashboard typography should prioritize:

* readability
* density balance
* information scanning

---

# Table Text

```tsx id="qpsxvm"
<td className="text-sm">
```

---

# Sidebar Labels

```tsx id="d9tq9i"
<span className="text-sm font-medium">
```

---

# Analytics Numbers

```tsx id="ye2nmc"
<span className="text-3xl font-bold tracking-tight">
```

---

# 12. Accessibility Rules

---

# MINIMUM CONTRAST RATIO

Must meet:

```txt id="1lv4qv"
WCAG AA
```

Minimum:

* 4.5:1 normal text
* 3:1 large text

---

# FOCUS STATES REQUIRED

Every interactive element must support:

```css id="b6v0n8"
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-primary
```

---

# NEVER REMOVE

```css id="v2kax0"
outline
```

without accessible replacement.

---

# 13. Dark Mode Typography

Use:

```tsx id="j8l0o1"
class="dark"
```

strategy.

---

# Dark Mode Text Tokens

```css id="v22xly"
--foreground
--muted-foreground
--primary-foreground
```

---

# Example

```tsx id="y3t4jd"
<p className="text-muted-foreground dark:text-muted-foreground">
```

---

# 14. Tailwind Typography Utility Examples

---

# Hero Heading

```tsx id="5m4m9m"
<h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
```

---

# Section Heading

```tsx id="9v3m4u"
<h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
```

---

# Product Card Title

```tsx id="rm3q2l"
<h3 className="line-clamp-2 text-base font-medium">
```

---

# Checkout Total

```tsx id="fsl1qo"
<span className="text-2xl font-bold">
```

---

# Button Typography

```tsx id="1h8vqx"
<button className="text-sm font-semibold tracking-wide">
```

---

# 15. Typography Component System

Recommended:

```bash
components/ui/typography.tsx
```

---

# Example

```tsx id="2bkrg8"
interface TypographyProps {
  children: React.ReactNode;
  className?: string;
}

export function H1({
  children,
  className,
}: TypographyProps) {
  return (
    <h1
      className={cn(
        "text-4xl font-bold tracking-tight",
        className
      )}
    >
      {children}
    </h1>
  );
}
```

---

# 16. Mobile Typography Optimization

Important for Bangladesh users:

* low-end Android devices
* small screens
* inconsistent network quality

Rules:

* avoid tiny text
* minimum body text 16px
* maintain readable spacing
* optimize for thumb scanning

---

# 17. SEO Typography Rules

Use semantic headings properly:

```txt id="y1f6sh"
1 H1 only
```

Then:

* H2
* H3
* H4 hierarchy

Never skip hierarchy.

---

# 18. Performance Rules

Use:

```tsx id="vgj9hf"
display: "swap"
```

for all fonts.

Benefits:

* prevents invisible text
* improves Core Web Vitals

---

# PRELOAD IMPORTANT FONTS

Critical fonts only.

Avoid:

* loading too many weights
* unnecessary subsets

---

# 19. Animation Typography Rules

Typography animations must:

* avoid layout shift
* respect reduced motion
* avoid excessive blur

Use:

* opacity
* translateY
* subtle scale

---

# 20. Reduced Motion Support

Required:

```css id="t4u7ah"
@media (prefers-reduced-motion: reduce)
```

Disable:

* excessive transitions
* bouncing animations

---

# 21. Typography Naming Rules

GOOD:

```tsx id="3o8nh5"
text-muted-foreground
```

BAD:

```tsx id="cqu6h9"
text-gray-500
```

Always use semantic tokens.

---

# 22. Recommended Typography Hierarchy

| Level   | Usage                     |
| ------- | ------------------------- |
| H1      | page hero                 |
| H2      | major sections            |
| H3      | product/category sections |
| H4      | cards/widgets             |
| Body    | descriptions              |
| Caption | metadata                  |

---

# 23. Final Typography Goals

This typography system ensures:

* excellent readability
* ecommerce clarity
* dashboard usability
* accessibility compliance
* responsive scaling
* dark mode support
* high-performance rendering
* maintainable design consistency

The system must feel:

* modern
* premium
* trustworthy
* clean
* scalable

```
```
