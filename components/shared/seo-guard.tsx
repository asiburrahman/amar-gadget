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
      } else if (h1Count === 0) {
        console.warn(
          `⚠️ SEO Warning: No H1 element found on this page. Search engines prefer exactly 1 H1 element per page for optimal accessibility and search ranking.`
        );
      }
    }
  }, []);

  return <>{children}</>;
}
