import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUserWithRole } from "@/lib/session";
import { listAdminSiteArticles } from "@/lib/site-content";
import { SiteContentError } from "@/lib/site-content-policy";
import { SITE_PAGE_SLUGS } from "@/lib/validations/site-content";

export default async function ContentSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getCurrentUserWithRole(["ADMIN"]);
  if (!actor) redirect("/login");
  const { page } = await searchParams;
  if (page !== undefined && (typeof page !== "string" || !/^[1-9]\d{0,5}$/.test(page))) notFound();
  const result = await listAdminSiteArticles(actor, Number(page ?? 1)).catch((error: unknown) => {
    if (error instanceof SiteContentError && error.status === 404) notFound();
    throw error;
  });
  return <main className="mx-auto max-w-5xl space-y-8 p-6">
    <h1 className="text-3xl font-bold">Public pages and articles</h1>
    <p>Save private drafts, review the saved revision and publish explicitly. Later draft edits do not change the current publication. Unpublishing withdraws the public document and retains its history.</p>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Information pages</h2>
      <ul className="flex flex-wrap gap-4">{SITE_PAGE_SLUGS.map((slug) => <li key={slug}><Link className="underline" href={`/admin/settings/content/edit?kind=PAGE&slug=${slug}`}>{slug}</Link></li>)}</ul>
    </section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Start an article</h2>
      <form action="/admin/settings/content/edit" method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="kind" value="ARTICLE" />
        <label className="grid gap-2">Permanent URL slug<input className="rounded border px-3 py-2" name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={1} maxLength={100} required aria-describedby="article-slug-help" /></label>
        <button className="rounded border px-3 py-2">Open article editor</button>
      </form>
      <p id="article-slug-help">Use lowercase letters, numbers and single hyphens. The URL slug stays fixed; titles and article text can use any supported language. Opening an existing slug loads its retained document.</p>
    </section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Saved articles</h2>
      <p>{result.articles.total} articles; page {result.articles.page} of {result.articles.totalPages}.</p>
      {result.articles.rows.length === 0 && <p>No article drafts have been saved.</p>}
      {result.articles.rows.map((article) => <article key={article.slug} className="space-y-2 rounded border p-4">
        <h3 className="font-semibold"><Link className="underline" href={`/admin/settings/content/edit?kind=ARTICLE&slug=${encodeURIComponent(article.slug)}`}>{article.title || "Untitled draft"}</Link></h3>
        <p>/{article.slug}; saved revision {article.version}; {article.publishedVersion === null ? "unpublished" : `publication revision ${article.publishedVersion}`}</p>
        <p>Updated <time dateTime={article.updatedAt}>{article.updatedAt}</time></p>
      </article>)}
      {result.articles.totalPages > 1 && <nav aria-label="Saved article pages" className="flex gap-4">
        {result.articles.page > 1 && <Link rel="prev" href={`/admin/settings/content?page=${result.articles.page - 1}`}>Previous articles</Link>}
        {result.articles.page < result.articles.totalPages && <Link rel="next" href={`/admin/settings/content?page=${result.articles.page + 1}`}>Next articles</Link>}
      </nav>}
    </section>
  </main>;
}
