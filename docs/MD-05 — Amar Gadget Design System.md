# MD-05 — Amar Gadget Design System

````md id="w0rm4u"
# MD-05 — Amar Gadget Design System
## Production UI Architecture
### Next.js 16 + Tailwind CSS v4 + Framer Motion

---

# 1. DESIGN SYSTEM GOALS

The Amar Gadget design system must provide:

- modern ecommerce UI
- premium visual identity
- consistent spacing
- scalable components
- accessibility compliance
- responsive layouts
- dark mode support
- high conversion UX

The UI should feel:
- fast
- trustworthy
- modern
- minimal
- clean
- professional

Inspired by:
- Apple
- Stripe
- Linear
- Vercel
- Amazon modern UI

---

# 2. DESIGN PRINCIPLES

---

# PRIORITIES

1. readability
2. usability
3. accessibility
4. consistency
5. responsiveness
6. performance

---

# UI RULES

Always:
- use semantic tokens
- use consistent spacing
- use responsive layouts
- support keyboard navigation
- support dark mode

Never:
- use hardcoded colors
- use inconsistent spacing
- use inline styles
- use random shadow values

---

# 3. COLOR SYSTEM

---

# SEMANTIC COLOR TOKENS

| Token | Purpose |
|---|---|
| primary | brand actions |
| secondary | secondary actions |
| accent | highlights |
| muted | low emphasis |
| destructive | danger |
| success | confirmations |
| warning | alerts |
| border | borders |
| background | page background |
| foreground | text |

---

# 4. PRIMARY BRAND COLORS

Amar Gadget Brand Identity:

| Usage | Color |
|---|---|
| Primary | #0F172A |
| Accent | #2563EB |
| Success | #16A34A |
| Warning | #EA580C |
| Destructive | #DC2626 |

---

# 5. TAILWIND V4 COLOR TOKENS

## styles/globals.css

```css id="4qv1mv"
@theme {
  --color-background: #ffffff;
  --color-foreground: #0f172a;

  --color-primary: #0f172a;
  --color-primary-foreground: #ffffff;

  --color-secondary: #f8fafc;
  --color-secondary-foreground: #0f172a;

  --color-accent: #2563eb;
  --color-accent-foreground: #ffffff;

  --color-muted: #f1f5f9;
  --color-muted-foreground: #64748b;

  --color-border: #e2e8f0;

  --color-success: #16a34a;
  --color-warning: #ea580c;
  --color-destructive: #dc2626;
}
````

---

# 6. DARK MODE TOKENS

Use:

```tsx id="e4z2qs"
class="dark"
```

strategy.

---

# DARK MODE COLORS

```css id="0f2z9n"
.dark {
  --color-background: #020617;
  --color-foreground: #f8fafc;

  --color-primary: #f8fafc;
  --color-primary-foreground: #020617;

  --color-secondary: #0f172a;
  --color-secondary-foreground: #f8fafc;

  --color-muted: #111827;
  --color-muted-foreground: #94a3b8;

  --color-border: #1e293b;
}
```

---

# 7. SPACING SYSTEM

Use 4px base spacing scale.

| Token | Value |
| ----- | ----- |
| 1     | 4px   |
| 2     | 8px   |
| 3     | 12px  |
| 4     | 16px  |
| 5     | 20px  |
| 6     | 24px  |
| 8     | 32px  |
| 10    | 40px  |
| 12    | 48px  |
| 16    | 64px  |

---

# SPACING RULES

Always use:

```tsx id="l8tt6x"
gap-4
p-6
space-y-8
```

Never use arbitrary spacing:

```tsx id="pvx1x7"
mt-[37px]
```

unless absolutely necessary.

---

# 8. BORDER RADIUS SYSTEM

| Token | Value |
| ----- | ----- |
| sm    | 6px   |
| md    | 10px  |
| lg    | 14px  |
| xl    | 18px  |
| 2xl   | 24px  |

---

# USAGE

| Component | Radius |
| --------- | ------ |
| Button    | lg     |
| Card      | xl     |
| Modal     | 2xl    |
| Input     | lg     |

---

# 9. SHADOW SYSTEM

Use soft layered shadows.

---

# TOKENS

| Token     | Usage         |
| --------- | ------------- |
| shadow-sm | small cards   |
| shadow-md | dropdowns     |
| shadow-lg | modals        |
| shadow-xl | hero sections |

---

# RULE

Avoid:

* overly dark shadows
* heavy neumorphism

---

# 10. LAYOUT SYSTEM

---

# MAX WIDTHS

| Container | Width  |
| --------- | ------ |
| page      | 1440px |
| content   | 1280px |
| text      | 768px  |

---

# CONTAINER CLASS

```tsx id="g4d1b8"
<div className="mx-auto w-full max-w-7xl px-4 md:px-6">
```

---

# 11. GRID SYSTEM

---

# PRODUCT GRID

```tsx id="5ztnk0"
grid-cols-2
md:grid-cols-3
lg:grid-cols-4
xl:grid-cols-5
```

---

# DASHBOARD GRID

```tsx id="vbtb4s"
grid-cols-1
lg:grid-cols-[260px_1fr]
```

---

# 12. BUTTON SYSTEM

---

# BUTTON VARIANTS

Required variants:

* default
* secondary
* outline
* ghost
* destructive
* link

---

# BUTTON SIZES

| Size | Height |
| ---- | ------ |
| sm   | 36px   |
| md   | 44px   |
| lg   | 52px   |

---

# BUTTON EXAMPLE

```tsx id="5h5gqt"
<Button variant="default" size="md">
  Add to Cart
</Button>
```

---

# BUTTON RULES

Buttons must:

* support loading state
* support disabled state
* support keyboard focus
* support icons

---

# 13. INPUT SYSTEM

---

# INPUT STATES

Required:

* default
* focus
* disabled
* invalid
* loading

---

# INPUT EXAMPLE

```tsx id="6e0h5m"
<Input
  type="email"
  placeholder="Enter your email"
/>
```

---

# INPUT RULES

Inputs must:

* have labels
* have aria-describedby
* support validation errors

---

# 14. CARD SYSTEM

Cards are core ecommerce components.

---

# CARD RULES

Cards must:

* use semantic padding
* support hover states
* support dark mode
* support loading skeleton

---

# PRODUCT CARD EXAMPLE

```tsx id="6j6rfx"
<Card className="overflow-hidden rounded-2xl">
```

---

# 15. BADGE SYSTEM

Badge variants:

* success
* warning
* destructive
* outline
* secondary

---

# USAGE

* stock status
* discounts
* order status
* seller verification

---

# 16. MODAL SYSTEM

Use:

* accessible dialogs
* focus trapping
* ESC close
* overlay blur

---

# MODAL RULES

Must support:

* keyboard navigation
* screen readers
* reduced motion

---

# 17. TOAST SYSTEM

Toast types:

* success
* error
* warning
* info

Use:

```tsx id="5xby2i"
sonner
```

recommended.

---

# 18. SKELETON SYSTEM

Use skeletons for:

* product loading
* dashboard loading
* image loading

---

# RULE

Never use:

```txt id="lm59im"
Loading...
```

alone.

---

# 19. NAVIGATION DESIGN

Navbar must support:

* sticky behavior
* mobile menu
* category dropdown
* search
* cart badge
* dark mode toggle

---

# 20. SIDEBAR DESIGN

Dashboard sidebar must:

* support collapse
* support mobile drawer
* highlight active route

---

# 21. TABLE DESIGN

Tables required for:

* orders
* users
* products
* payouts

---

# TABLE RULES

Tables must:

* support horizontal scroll
* support sorting
* support pagination
* support loading state

---

# 22. FORM DESIGN

Forms must support:

* validation messages
* loading states
* disabled states
* accessibility labels

---

# FORM RULES

Never submit invalid forms.

Always:

* validate client-side
* validate server-side

---

# 23. ANIMATION SYSTEM

Use:

```tsx id="s3n1ri"
Framer Motion
```

for animations.

---

# ALLOWED ANIMATIONS

* fade
* slide
* scale
* accordion
* hover micro interactions

---

# AVOID

* excessive bouncing
* flashy effects
* long animations

---

# 24. MICRO INTERACTIONS

Examples:

* button hover
* cart updates
* wishlist toggle
* image zoom

---

# DURATION RULES

| Animation       | Duration |
| --------------- | -------- |
| hover           | 150ms    |
| modal           | 250ms    |
| page transition | 300ms    |

---

# 25. ACCESSIBILITY RULES

Required:

* WCAG AA
* keyboard navigation
* focus-visible styles
* aria labels
* semantic HTML

---

# MODAL ACCESSIBILITY

Must:

* trap focus
* restore focus after close
* support ESC close

---

# 26. FOCUS STYLES

Required:

```css id="qgmmy9"
focus-visible:ring-2
focus-visible:ring-primary
focus-visible:outline-none
```

---

# 27. REDUCED MOTION SUPPORT

Use:

```css id="0d6m55"
@media (prefers-reduced-motion: reduce)
```

Disable:

* unnecessary animations
* parallax effects

---

# 28. IMAGE DESIGN RULES

Use:

```tsx id="jlwm9v"
next/image
```

Always:

* optimize images
* lazy load
* use blur placeholders

---

# PRODUCT IMAGE RULES

Images must:

* maintain aspect ratio
* support zoom
* support responsive sizes

---

# 29. ECOMMERCE UX RULES

Important CTAs:

* Add to Cart
* Buy Now
* Checkout

must be:

* visually dominant
* high contrast
* thumb reachable on mobile

---

# 30. MOBILE-FIRST RULES

Optimize for:

* low-end Android devices
* Bangladesh mobile users
* touch navigation

---

# MOBILE REQUIREMENTS

Must support:

* sticky bottom cart
* mobile checkout
* thumb-friendly spacing

---

# 31. DARK MODE RULES

Dark mode must support:

* semantic colors
* accessible contrast
* proper image overlays

---

# 32. PERFORMANCE RULES

Avoid:

* massive animations
* unnecessary rerenders
* oversized images

---

# USE

* dynamic imports
* lazy loading
* memoization where needed

---

# 33. COMPONENT LIBRARY STRUCTURE

```bash id="l1yqvt"
components/ui/
│
├── button.tsx
├── input.tsx
├── textarea.tsx
├── card.tsx
├── badge.tsx
├── modal.tsx
├── skeleton.tsx
├── toast.tsx
├── dropdown.tsx
├── tabs.tsx
├── accordion.tsx
├── table.tsx
├── pagination.tsx
├── avatar.tsx
├── checkbox.tsx
├── switch.tsx
└── tooltip.tsx
```

---

# 34. NAMING RULES

GOOD:

```tsx id="hmy4nx"
text-muted-foreground
bg-primary
border-border
```

BAD:

```tsx id="y89ow7"
text-gray-500
bg-blue-500
```

Use semantic tokens only.

---

# 35. DESIGN QA CHECKLIST

Before shipping UI:

* responsive tested
* keyboard tested
* dark mode tested
* loading states tested
* accessibility tested
* mobile tested
* performance tested

---

# 36. FINAL DESIGN GOALS

The Amar Gadget design system must provide:

* scalable UI architecture
* enterprise consistency
* premium ecommerce UX
* accessibility compliance
* dark mode support
* responsive layouts
* high conversion optimization
* maintainable component structure

The UI must feel:

* modern
* trustworthy
* clean
* premium
* fast
* conversion-focused

```
```
