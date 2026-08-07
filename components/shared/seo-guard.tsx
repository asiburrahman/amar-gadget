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
          `[SEO Guard Warning] Route "${pathname}": Found ${h1Count} H1 elements on this page. Search engines prefer exactly 1 H1 element per page.`
        );
      } else if (h1Count === 0) {
        console.warn(
          `[SEO Guard Warning] Route "${pathname}": No H1 element found on this page. Search engines prefer exactly 1 H1 element per page for optimal accessibility and indexing.`
        );
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [pathname, disabled]);

  return <>{children}</>;
}
