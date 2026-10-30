"use client";
import { useEffect, useRef, useState } from "react";
import { fetchReviewJson } from "@/lib/client/review-client";
import type { PublicReviewPage } from "@/lib/validations/review";
import { ReviewForm } from "@/components/forms/review-form";
import { RatingSummary } from "@/components/reviews/rating-summary";
export function ProductReviews({ productId, initialPage }: { productId: string; initialPage: PublicReviewPage | null }) {
  const [data, setData] = useState(initialPage), [error, setError] = useState(initialPage ? "" : "Reviews are temporarily unavailable. Retry loading current reviews."), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const sequence = useRef(0), reader = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reader.current?.abort(); }; }, []);
  async function load(page = 1) {
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller; const request = ++sequence.current; setBusy(true); setError(""); setNotice("");
    try {
      let result = await fetchReviewJson<PublicReviewPage>(`/api/reviews?productId=${encodeURIComponent(productId)}&page=${page}`, { signal: controller.signal });
      if (page !== 1 && data && result.version !== data.version) {
        result = await fetchReviewJson<PublicReviewPage>(`/api/reviews?productId=${encodeURIComponent(productId)}&page=1`, { signal: controller.signal });
        if (mounted.current && request === sequence.current) setNotice("Reviews changed while browsing. Showing the current first page.");
      }
      if (mounted.current && !controller.signal.aborted && request === sequence.current) setData(result);
    } catch (cause) { if (mounted.current && !controller.signal.aborted && request === sequence.current) setError(cause instanceof Error ? cause.message : "Unable to load reviews."); }
    finally { if (mounted.current && request === sequence.current) setBusy(false); }
  }
  return <section id="reviews" aria-label="Customer reviews" className="mt-8 border rounded-xl p-6 space-y-5">
    <h2 className="text-xl font-bold">Customer reviews</h2>
    <p>Published feedback from delivered, paid purchases. New and edited reviews await moderation.</p>
    {data && <RatingSummary rating={data.rating} count={data.total} />}
    {busy && <p role="status">Loading current reviews...</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={() => void load()} className="underline">Refresh published reviews</button>
    {data && <>{data.total === 0 && <p>No published purchase reviews yet.</p>}<ul className="space-y-4">{data.reviews.map((review) => <li key={review.id} className="border-b pb-4 space-y-2"><h3 className="font-semibold">{review.displayName} <span className="text-sm font-normal">Verified purchase</span></h3><RatingSummary rating={review.rating} /><p className="whitespace-pre-wrap break-words">{review.comment ?? "Rating only; no written comment supplied."}</p><p className="text-sm">Submitted <time dateTime={review.createdAt}>{review.createdAt.slice(0, 10)}</time> (UTC)</p></li>)}</ul>
      <nav aria-label="Published review pages" className="flex gap-4"><button type="button" disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}>Previous published reviews</button><span>Page {data.page} of {data.totalPages}</span><button type="button" disabled={busy || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>Next published reviews</button></nav></>}
    <ReviewForm productId={productId} onSaved={() => void load()} />
  </section>;
}
