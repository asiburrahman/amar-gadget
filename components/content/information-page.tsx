import Link from "next/link";
import { PublishedDocumentView } from "@/components/content/published-document";
import { informationGuides, readInformationPage, type InformationSlug } from "@/lib/site-information";
import { serializeJsonLd } from "@/lib/seo/serialize-json-ld";

export async function InformationPage({ slug }: { slug: InformationSlug }) {
  const document = await readInformationPage(slug);
  const guide = informationGuides[slug];
  return <main>
    {document ? <>
      <PublishedDocumentView document={document} />
      {slug === "faq" && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: document.sections.map((section) => ({ "@type": "Question", name: section.heading,
          acceptedAnswer: { "@type": "Answer", text: section.body } })),
      }) }} />}
    </> : <article className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <header className="space-y-3"><h1 className="text-3xl font-bold">{guide.title}</h1><p>{guide.summary}</p></header>
      <p className="rounded-xl border p-4" role="status">No operator document is currently published on this page. The guidance below explains where to get help.</p>
      {guide.sections.map((section) => <section key={section.heading} className="space-y-3"><h2 className="text-xl font-semibold">{section.heading}</h2><p className="leading-relaxed">{section.body}</p></section>)}
    </article>}
    <nav aria-label="Shopping information" className="mx-auto flex max-w-3xl flex-wrap gap-4 px-4 pb-12">
      <Link href="/contact" className="underline">Contact support</Link>
      <Link href="/products" className="underline">Browse products</Link>
      <Link href="/user/orders" className="underline">Your orders</Link>
      <Link href="/track-order" className="underline">Track order</Link>
    </nav>
  </main>;
}
