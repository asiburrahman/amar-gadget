import { renderToStaticMarkup } from "react-dom/server";
import { InformationPage } from "@/components/content/information-page";
import { informationMetadata } from "@/lib/site-information";
import BlogPage, { generateMetadata as blogMetadata } from "@/app/(marketing)/blog/page";
import ArticlePage, { generateMetadata as articleMetadata } from "@/app/(marketing)/blog/[slug]/page";
import { listPublicSiteArticles, readPublishedSiteContent } from "@/lib/site-content";
import { SiteContentError } from "@/lib/site-content-policy";

jest.mock("@/lib/site-content", () => ({ listPublicSiteArticles: jest.fn(), readPublishedSiteContent: jest.fn() }));
jest.mock("next/server", () => ({ connection: jest.fn().mockResolvedValue(undefined) }));
jest.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));

const publication = {
  kind: "ARTICLE", slug: "reviewed-article", version: 2, path: "/blog/reviewed-article", title: "Reviewed operator article",
  summary: "Operator supplied summary of the actual article.", byline: "Published author", publishedAt: "2026-11-05T08:00:00.000Z",
  sections: [{ heading: "</script><script>alert(1)</script>", body: "<img src=x onerror=alert(2)>\nRetained plain text." }],
};
beforeEach(() => {
  jest.clearAllMocks();
  (readPublishedSiteContent as jest.Mock).mockResolvedValue(null);
  (listPublicSiteArticles as jest.Mock).mockResolvedValue({ page: 1, total: 0, totalPages: 1, rows: [] });
});

it("shows an honest unconfigured guide without publishing invented operator policies or FAQ schema", async () => {
  const html = renderToStaticMarkup(await InformationPage({ slug: "terms" }));
  expect(html).toContain("has not published its terms"); expect(html).toContain('href="/contact"');
  expect(html).not.toContain('type="application/ld+json"');
  expect((await informationMetadata("terms")).robots).toMatchObject({ index: false });
  const faq = renderToStaticMarkup(await InformationPage({ slug: "faq" }));
  expect(faq).toContain("phone number used at checkout"); expect(faq).not.toContain('"@type":"FAQPage"');
});

it("renders issued plain text and safe FAQ structured data from the same publication", async () => {
  (readPublishedSiteContent as jest.Mock).mockResolvedValue({ ...publication, kind: "PAGE", slug: "faq", path: "/faq" });
  const html = renderToStaticMarkup(await InformationPage({ slug: "faq" }));
  expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;"); expect(html).not.toContain("<img");
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(JSON.parse(scripts[0][1]).mainEntity[0]).toEqual({ "@type": "Question", name: publication.sections[0].heading, acceptedAnswer: { "@type": "Answer", text: publication.sections[0].body } });
  expect(scripts[0][1]).not.toContain("</script>");
  const metadata = await informationMetadata("faq");
  expect(metadata).toMatchObject({ description: publication.summary, robots: { index: true } });
});

it("propagates actual service failures instead of showing a healthy empty blog or policy guide", async () => {
  const failure = Error("Content service unavailable");
  (readPublishedSiteContent as jest.Mock).mockRejectedValue(failure);
  (listPublicSiteArticles as jest.Mock).mockRejectedValue(failure);
  await expect(InformationPage({ slug: "about" })).rejects.toBe(failure);
  await expect(informationMetadata("about")).rejects.toBe(failure);
  await expect(BlogPage({ searchParams: Promise.resolve({}) })).rejects.toBe(failure);
  await expect(ArticlePage({ params: Promise.resolve({ slug: "reviewed-article" }) })).rejects.toBe(failure);
});

it("connects published article summaries to detail pages without fabricated dates, authors or sample cards", async () => {
  const empty = renderToStaticMarkup(await BlogPage({ searchParams: Promise.resolve({}) }));
  expect(empty).toContain("No articles have been published"); expect(empty).not.toContain("iphone-16-pro-review");
  (listPublicSiteArticles as jest.Mock).mockResolvedValue({ page: 2, total: 21, totalPages: 2, rows: [publication] });
  const listing = renderToStaticMarkup(await BlogPage({ searchParams: Promise.resolve({ page: "2" }) }));
  expect(listing).toContain('href="/blog/reviewed-article"'); expect(listing).toContain("Showing 21–21 of 21"); expect(listing).toContain('rel="prev" href="/blog"');
  expect(await blogMetadata({ searchParams: Promise.resolve({ page: "2" }) })).toMatchObject({ robots: { index: false, follow: true }, alternates: { canonical: "http://localhost/blog?page=2" } });
  (readPublishedSiteContent as jest.Mock).mockResolvedValue(publication);
  const detail = renderToStaticMarkup(await ArticlePage({ params: Promise.resolve({ slug: publication.slug }) }));
  expect(detail).toContain(publication.title); expect(detail).toContain("&lt;img");
  expect(await articleMetadata({ params: Promise.resolve({ slug: publication.slug }) })).toMatchObject({ description: publication.summary, alternates: { canonical: `http://localhost${publication.path}` }, openGraph: { type: "article", publishedTime: publication.publishedAt } });
});

it("returns not found for unpublished articles, unsafe slugs, ambiguous pages and out-of-range collections", async () => {
  for (const slug of ["missing", "../private", "reviewed-article "]) {
    await expect(ArticlePage({ params: Promise.resolve({ slug }) })).rejects.toThrow("NOT_FOUND");
  }
  for (const page of ["0", "01", "1e2", ["1", "2"]]) {
    await expect(BlogPage({ searchParams: Promise.resolve({ page }) })).rejects.toThrow("NOT_FOUND");
  }
  (listPublicSiteArticles as jest.Mock).mockRejectedValue(new SiteContentError("Page not found", 404));
  await expect(BlogPage({ searchParams: Promise.resolve({ page: "2" }) })).rejects.toThrow("NOT_FOUND");
});
