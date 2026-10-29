import Link from "next/link";
import { getActiveCampaigns } from "@/lib/campaigns";
import { CampaignCard } from "@/components/catalog/campaign-card";
import { campaignPageSchema } from "@/lib/validations/campaign";
import { paginatedMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return paginatedMetadata("/deals", "Current campaigns", "Active product campaigns using current catalog offers in BDT.", (searchParams ? await searchParams : {}).page);
}
export default async function DealsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = searchParams ? await searchParams : {};
  const parsed = campaignPageSchema.safeParse(query.page);
  if (!parsed.success) return <main className="container mx-auto p-6"><h1>Current campaigns</h1><p role="alert">Invalid campaign page. <Link href="/deals">Reset campaign page</Link></p></main>;
  let result: Awaited<ReturnType<typeof getActiveCampaigns>>;
  try { result = await getActiveCampaigns(parsed.data); }
  catch { return <main className="container mx-auto p-6"><h1>Current campaigns</h1><p role="alert">Campaigns are temporarily unavailable. <Link href="/deals">Retry campaigns</Link></p></main>; }
  return <main className="container mx-auto max-w-7xl p-6 space-y-6"><h1 className="text-3xl font-bold">Current campaigns</h1><p>Discover approved, in-stock products with current catalog discounts.</p>
    {result.campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} serverNow={result.now} />)}
    {!result.campaigns.length && <p role="status">{result.total ? "No campaigns on this page." : "No active campaigns with eligible products right now."} <Link href="/products?filter=sale" className="underline">Browse current catalog sale prices</Link></p>}
    {result.total > 0 && !result.campaigns.length && <Link href="/deals">Return to the first campaign page</Link>}
    {result.campaigns.length > 0 && <nav aria-label="Campaign pages" className="flex gap-4">{result.page > 1 && <Link href={`/deals?page=${result.page - 1}`}>Previous campaigns</Link>}<span>Page {result.page} of {result.totalPages}</span>{result.page < result.totalPages && <Link href={`/deals?page=${result.page + 1}`}>Next campaigns</Link>}</nav>}
  </main>;
}
