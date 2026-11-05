import type { readPublishedSiteContent } from "@/lib/site-content";

export type PublishedDocument = NonNullable<Awaited<ReturnType<typeof readPublishedSiteContent>>>;

export function PublishedDocumentView({ document }: { document: PublishedDocument }) {
  return <article className="mx-auto max-w-3xl space-y-8 px-4 py-12">
    <header className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{document.title}</h1>
      <p className="text-lg text-muted-foreground">{document.summary}</p>
      {document.byline && <p>{document.byline}</p>}
      <p className="text-sm text-muted-foreground">Published <time dateTime={document.publishedAt}>{document.publishedAt.slice(0, 10)} (UTC)</time></p>
    </header>
    {document.sections.map((section, index) => <section key={index} aria-labelledby={`document-section-${index}`} className="space-y-3">
      <h2 id={`document-section-${index}`} className="text-xl font-semibold">{section.heading}</h2>
      <p className="whitespace-pre-wrap wrap-break-word leading-relaxed">{section.body}</p>
    </section>)}
  </article>;
}
