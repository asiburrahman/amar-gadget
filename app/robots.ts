import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/seo/urls";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  // Crawlers can observe noindex headers. Session guards protect private data.
  return { rules: { userAgent: "*", allow: "/" }, sitemap: canonicalUrl("/sitemap.xml") };
}
