import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog-visibility";
import { brandCollectionHref } from "@/lib/validations/catalog-brand";
import { canonicalUrl, productPath, categoryPath } from "./urls";
import { SITEMAP_PUBLIC_PATHS } from "./policy";
import { siteContentAddressSchema } from "@/lib/validations/site-content";
import { siteContentPath } from "@/lib/site-content-policy";
export const SITEMAP_PAGE_SIZE = 1000;
const kinds = ["products", "categories", "brands", "articles"] as const;
type Kind = typeof kinds[number];
const taxonomyWhere = { products: { some: publicProductWhere } };
const publishedArticles = { kind: "ARTICLE", publishedVersion: { not: null } } as const;
const eligibleCategories = Prisma.sql`WITH RECURSIVE eligible AS (
 SELECT c.id,c."parentId" FROM "Category" c WHERE EXISTS(SELECT 1 FROM "Product" p JOIN "User" u ON u.id=p."sellerId" WHERE p."categoryId"=c.id AND p.status=${publicProductWhere.status} AND u."sellerStatus"=${publicProductWhere.seller.sellerStatus})
 UNION SELECT c.id,c."parentId" FROM "Category" c JOIN eligible e ON c.id=e."parentId"
)`;
async function categoryCount(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`${eligibleCategories} SELECT count(*)::bigint AS count FROM eligible`);
  const count = Number(row.count); if (!Number.isSafeInteger(count)) throw new Error("Sitemap category count exceeds supported range"); return count;
}
const xml = (value: string) => value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
export function sitemapResponse(body: string, status = 200) { return new Response(body, { status, headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } }); }
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL statement_timeout = '4000ms'`; return work(tx); }, { isolationLevel: "RepeatableRead", timeout: 10_000, maxWait: 5000 });
}
function boundedUrl(path: string) {
  const url = canonicalUrl(path);
  if (url.length > 2048) throw new Error("Catalog URL exceeds sitemap protocol bounds.");
  return url;
}
export async function sitemapIndex() {
  const counts = await transaction(async (tx) => ({ products: await tx.product.count({ where: publicProductWhere }), categories: await categoryCount(tx), brands: await tx.brand.count({ where: taxonomyWhere }), articles: await tx.siteContent.count({ where: publishedArticles }) }));
  const pages = kinds.map((kind) => ({ kind, count: Math.ceil(counts[kind] / SITEMAP_PAGE_SIZE) }));
  if (pages.reduce((sum, page) => sum + page.count, 1) > 50_000) throw new Error("Sitemap index exceeds protocol bounds.");
  const locations = [boundedUrl("/sitemaps/pages.xml"), ...pages.flatMap(({ kind, count }) => Array.from({ length: count }, (_, index) => boundedUrl(`/sitemaps/${kind}-${index}.xml`)))];
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations.map((url) => `<sitemap><loc>${xml(url)}</loc></sitemap>`).join("")}</sitemapindex>`;
}
export async function sitemapFile(file: string): Promise<string | null> {
  let entries: { url: string; updatedAt?: Date }[];
  if (file === "pages.xml") entries = await transaction(async (tx) => {
    const published = await tx.siteContent.findMany({ where: { kind: "PAGE", publishedVersion: { not: null } },
      orderBy: { slug: "asc" }, take: 6, select: { kind: true, slug: true, publishedVersion: true, publication: { select: { version: true, action: true, reviewed: true, createdAt: true } } } });
    if (published.length > 5) throw Error("Unexpected operator information pages");
    const pages = published.map(publicationEntry);
    const articles = await tx.siteContent.count({ where: publishedArticles });
    return [...SITEMAP_PUBLIC_PATHS.map((path) => ({ url: boundedUrl(path) })), ...pages, ...(articles ? [{ url: boundedUrl("/blog") }] : [])];
  });
  else {
    const match = /^(products|categories|brands|articles)-(0|[1-9]\d{0,4})\.xml$/.exec(file);
    if (!match) return null;
    const kind = match[1] as Kind, page = Number(match[2]);
    entries = await transaction(async (tx) => {
      const count = kind === "products" ? await tx.product.count({ where: publicProductWhere }) : kind === "categories" ? await categoryCount(tx) : kind === "articles" ? await tx.siteContent.count({ where: publishedArticles }) : await tx.brand.count({ where: taxonomyWhere });
      if (page * SITEMAP_PAGE_SIZE >= count) return [];
      const pagination = { orderBy: { id: "asc" as const }, take: SITEMAP_PAGE_SIZE, skip: page * SITEMAP_PAGE_SIZE };
      if (kind === "articles") return (await tx.siteContent.findMany({ where: publishedArticles,
        orderBy: [{ publishedAt: "desc" }, { slug: "asc" }], take: SITEMAP_PAGE_SIZE, skip: page * SITEMAP_PAGE_SIZE,
        select: { kind: true, slug: true, publishedVersion: true, publication: { select: { version: true, action: true, reviewed: true, createdAt: true } } },
      })).map(publicationEntry);
      if (kind === "products") return (await tx.product.findMany({ ...pagination, where: publicProductWhere, select: { id: true, slug: true, updatedAt: true } })).map((product) => ({ url: boundedUrl(productPath(product.slug, product.id)), updatedAt: product.updatedAt }));
      if (kind === "categories") return (await tx.$queryRaw<{ id: string; slug: string; updatedAt: Date }[]>(Prisma.sql`${eligibleCategories} SELECT c.id,c.slug,c."updatedAt" FROM "Category" c JOIN eligible e ON e.id=c.id ORDER BY c.id LIMIT ${SITEMAP_PAGE_SIZE} OFFSET ${page * SITEMAP_PAGE_SIZE}`)).map((category) => ({ url: boundedUrl(categoryPath(category)), updatedAt: category.updatedAt }));
      return (await tx.brand.findMany({ ...pagination, where: taxonomyWhere, select: { id: true, slug: true, updatedAt: true } })).map((brand) => ({ url: boundedUrl(brandCollectionHref(brand)), updatedAt: brand.updatedAt }));
    });
    if (!entries.length) return null;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((entry) => `<url><loc>${xml(entry.url)}</loc>${entry.updatedAt ? `<lastmod>${entry.updatedAt.toISOString()}</lastmod>` : ""}</url>`).join("")}</urlset>`;
}

function publicationEntry(row: { kind: string; slug: string; publishedVersion: number | null; publication: { version: number; action: string; reviewed: boolean; createdAt: Date } | null }) {
  const address = siteContentAddressSchema.parse({ kind: row.kind, slug: row.slug }), publication = row.publication;
  if (!publication || publication.version !== row.publishedVersion || publication.action !== "PUBLISH" || !publication.reviewed) throw Error("Invalid sitemap publication evidence");
  return { url: boundedUrl(siteContentPath(address)), updatedAt: publication.createdAt };
}
