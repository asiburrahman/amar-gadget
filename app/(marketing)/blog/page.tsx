import { cache } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { listPublicSiteArticles } from "@/lib/site-content";
import { SiteContentError } from "@/lib/site-content-policy";
import { paginatedMetadata } from "@/lib/seo/metadata";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const readArticles = cache(async (page: number) => {
  await connection();
  try { return await listPublicSiteArticles(page); }
  catch (error) { if (error instanceof SiteContentError && error.status === 404) notFound(); throw error; }
});
function pageNumber(input: string | string[] | undefined) {
  if (input !== undefined && (typeof input !== "string" || !/^[1-9]\d{0,5}$/.test(input))) notFound();
  return Number(input ?? 1);
}
export async function generateMetadata({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page);
  await readArticles(page);
  return paginatedMetadata("/blog", "Marketplace articles", "Read articles published by the Amar Gadget marketplace operator.", String(page));
}
export default async function BlogPage({ searchParams }: Props) {
  const result = await readArticles(pageNumber((await searchParams).page));
  return <main className="container mx-auto space-y-8 px-4 py-12">
    <header className="space-y-3"><h1 className="text-3xl font-bold">Marketplace articles</h1>
      <p>Articles published by the marketplace operator.</p></header>
    {result.total === 0 ? <div className="space-y-3 rounded-xl border p-6">
      <p>No articles have been published yet.</p><Link href="/products" className="underline">Browse products</Link>
    </div> : <>
      <p role="status">Showing {(result.page - 1) * 20 + 1}–{Math.min(result.page * 20, result.total)} of {result.total} articles</p>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {result.rows.map((article) => <article key={article.slug} className="space-y-3 rounded-xl border p-6">
          <h2 className="text-xl font-semibold"><Link href={article.path} className="underline">{article.title}</Link></h2>
          <p>{article.summary}</p>
          {article.byline && <p className="text-sm text-muted-foreground">{article.byline}</p>}
          {article.publishedAt && <time className="block text-sm text-muted-foreground" dateTime={article.publishedAt}>{article.publishedAt.slice(0, 10)} (UTC)</time>}
        </article>)}
      </div>
      {result.totalPages > 1 && <nav aria-label="Article pages" className="flex items-center justify-center gap-6">
        {result.page > 1 && <Link rel="prev" href={result.page === 2 ? "/blog" : `/blog?page=${result.page - 1}`}>Previous page</Link>}
        <span aria-current="page">Page {result.page} of {result.totalPages}</span>
        {result.page < result.totalPages && <Link rel="next" href={`/blog?page=${result.page + 1}`}>Next page</Link>}
      </nav>}
    </>}
  </main>;
}
