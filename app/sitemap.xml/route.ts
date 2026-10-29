import { sitemapIndex, sitemapResponse } from "@/lib/seo/sitemaps";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return sitemapResponse(await sitemapIndex()); }
  catch { return new Response("Sitemap temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } }); }
}
