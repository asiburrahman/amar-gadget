import { sitemapFile, sitemapResponse } from "@/lib/seo/sitemaps";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  try { const body = await sitemapFile((await params).file); return body ? sitemapResponse(body) : new Response("Sitemap not found.", { status: 404, headers: { "Cache-Control": "no-store" } }); }
  catch { return new Response("Sitemap temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } }); }
}
