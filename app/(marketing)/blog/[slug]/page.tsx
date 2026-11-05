import { cache } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { readPublishedSiteContent } from "@/lib/site-content";
import { siteContentAddressSchema } from "@/lib/validations/site-content";
import { createMetadata } from "@/lib/seo/metadata";
import { PublishedDocumentView } from "@/components/content/published-document";

type Props = { params: Promise<{ slug: string }> };
const readArticle = cache(async (slug: string) => {
  await connection();
  const address = siteContentAddressSchema.safeParse({ kind: "ARTICLE", slug });
  if (!address.success || address.data.slug !== slug) notFound();
  const document = await readPublishedSiteContent(address.data);
  if (!document) notFound();
  return document;
});

export async function generateMetadata({ params }: Props) {
  const document = await readArticle((await params).slug);
  return createMetadata({ title: document.title, description: document.summary, canonicalUrl: document.path,
    type: "article", publishedTime: document.publishedAt, ...(document.byline ? { authors: [document.byline] } : {}) });
}

export default async function BlogArticlePage({ params }: Props) {
  const document = await readArticle((await params).slug);
  return <main>
    <div className="mx-auto max-w-3xl px-4 pt-8"><Link href="/blog" className="underline">All articles</Link></div>
    <PublishedDocumentView document={document} />
  </main>;
}
