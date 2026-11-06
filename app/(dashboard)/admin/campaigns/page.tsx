import Link from "next/link";
import { listAdminCampaigns } from "@/server/actions/admin/campaign-actions";
import { CampaignEditor } from "@/components/catalog/campaign-editor";
export const dynamic = "force-dynamic";
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams; const result = await listAdminCampaigns(input.page);
  return <main className="container mx-auto max-w-5xl p-6 space-y-6"><h1 className="text-3xl font-bold">Campaign management</h1><Link href="/admin">Back to dashboard</Link>
    <CampaignEditor />
    {!result.success ? <p role="alert">{result.error} <Link href="/admin/campaigns">Reload campaigns</Link></p> : <>
      <p>{result.total} campaigns</p>{result.campaigns.map((campaign) => <CampaignEditor key={`${campaign.id}-${campaign.version}`} campaign={campaign} />)}
      {!result.campaigns.length && <p>No campaigns on this page. <Link href="/admin/campaigns">Return to the first page</Link></p>}
      <nav aria-label="Admin campaign pages" className="flex gap-4">{result.page > 1 && <Link href={`/admin/campaigns?page=${result.page - 1}`}>Previous campaigns</Link>}{result.page < result.totalPages && <Link href={`/admin/campaigns?page=${result.page + 1}`}>Next campaigns</Link>}</nav>
    </>}
  </main>;
}
