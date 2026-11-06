"use client";
import { errorReference } from "@/lib/error-reference";
type Props = { error: unknown; retry: () => void; title?: string; href?: string; linkLabel?: string };
export function ServiceErrorView({ error, retry, title = "Page temporarily unavailable", href = "/", linkLabel = "Go to the homepage" }: Props) {
  const reference = errorReference(error);
  return <main className="mx-auto max-w-3xl space-y-5 p-6" style={{ padding: "2rem", maxWidth: "48rem", margin: "0 auto" }}>
    <h1 className="text-2xl font-bold">{title}</h1>
    <p role="alert">We could not load this page right now. Try again to request the latest data.</p>
    {reference && <p>Support reference: <code>{reference}</code></p>}
    <div className="flex flex-wrap gap-4"><button type="button" onClick={() => retry()} className="rounded border px-4 py-2" style={{ padding: "0.6rem 1rem", cursor: "pointer" }}>Try again</button><a href={href} className="underline">{linkLabel}</a></div>
  </main>;
}
