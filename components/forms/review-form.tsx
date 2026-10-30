"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { currentReviewScope, fetchReviewJson } from "@/lib/client/review-client";
import { useReviewResource } from "@/hooks/use-review-resource";
import { createReviewSchema, editReviewSchema, type OwnedReview, type ReviewAccess } from "@/lib/validations/review";

export function ReviewForm({ productId, onSaved }: { productId: string; onSaved?: () => void }) {
  const { user, loading } = useAuthStore();
  if (loading) return <p role="status">Checking your review account...</p>;
  if (!user?.isVerified) return <p><Link className="underline" href="/login">Sign in with a verified account</Link> to review a delivered purchase.</p>;
  return <ReviewEditor key={`${user.id}:${user.role}:${productId}`} ownerId={user.id} productId={productId} onSaved={onSaved} />;
}
function ReviewEditor({ productId, ownerId, onSaved }: { productId: string; ownerId: string; onSaved?: () => void }) {
  const resource = useReviewResource<ReviewAccess>(`/api/user/reviews?productId=${encodeURIComponent(productId)}`, ownerId);
  const [notice, setNotice] = useState("");
  const router = useRouter();
  return <section aria-label="Your purchase review" className="rounded-xl border p-4 space-y-3">
    <h3 className="text-lg font-bold">Your purchase review</h3>
    <Link href="/user/reviews" className="underline">My purchase review history</Link>
    {notice && <p role="status">{notice}</p>}
    {resource.loading && <p role="status">Loading your review eligibility...</p>}
    {resource.error && <p role="alert">{resource.error}</p>}
    <button type="button" onClick={resource.refresh} className="underline">Reload current review (discard unsaved edits)</button>
    {resource.data && <ReviewDraft key={`${resource.data.review?.id ?? "new"}:${resource.data.review?.version ?? 0}`} access={resource.data} ownerId={ownerId} onSaved={(review) => { setNotice(review.status === "WITHDRAWN" ? "Review withdrawn. You can explicitly resubmit it later." : "Review saved as pending. It will appear publicly after moderation."); resource.refresh(); onSaved?.(); router.refresh(); }} />}
  </section>;
}
function ReviewDraft({ access, ownerId, onSaved }: { access: ReviewAccess; ownerId: string; onSaved: (review: OwnedReview) => void }) {
  const review = access.review;
  const [rating, setRating] = useState(review && review.rating >= 1 && review.rating <= 5 ? String(review.rating) : "");
  const [comment, setComment] = useState(review?.comment ?? ""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const writer = useRef<AbortController | null>(null), writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; writer.current?.abort(); }; }, []);
  async function save(withdraw = false) {
    const captured = currentReviewScope(ownerId);
    if (!captured || writing.current) return;
    const body = withdraw && review ? { id: review.id, version: review.version } : review
      ? { id: review.id, version: review.version, rating: Number(rating), comment }
      : { productId: access.productId, rating: Number(rating), comment };
    if (!withdraw) {
      const parsed = (review ? editReviewSchema : createReviewSchema).safeParse(body);
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Choose a rating and valid review text."); return; }
      if (!access.eligible) { setError(access.reason); return; }
    }
    writing.current = true; writer.current = new AbortController(); setBusy(true); setError("");
    try {
      const response = await fetchReviewJson<{ review: OwnedReview }>("/api/user/reviews", { method: withdraw ? "DELETE" : review ? "PUT" : "POST", body: JSON.stringify(body), signal: writer.current.signal }, ownerId);
      if (mounted.current && currentReviewScope(ownerId) === captured) onSaved(response.review);
    } catch (cause) { if (mounted.current && currentReviewScope(ownerId) === captured) setError(cause instanceof Error ? cause.message : "Unable to confirm this review. Reload its current state before retrying."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  const id = `review-${access.productId}`;
  return <div className="space-y-3">
    <p>{access.reason}</p>
    {review && <><p>Current review status: <strong>{review.status}</strong></p>{review.moderationReason && <p>Moderation feedback: {review.moderationReason}</p>}{review.status === "LEGACY" && <p>Your historical review is retained privately. Submitting it again verifies the purchase and sends the reviewed text for moderation.</p>}</>}
    {error && <p role="alert">{error}</p>}
    {access.eligible && <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3">
      <fieldset disabled={busy} className="space-y-3"><div><label htmlFor={`${id}-rating`}>Rating (1–5)</label><select id={`${id}-rating`} required value={rating} onChange={(event) => setRating(event.target.value)} className="border rounded p-2 ml-2"><option value="">Choose a rating</option>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} out of 5</option>)}</select></div>
        <div><label htmlFor={`${id}-comment`}>Your product experience (optional, up to 2,000 characters)</label><textarea id={`${id}-comment`} maxLength={2000} rows={5} value={comment} onChange={(event) => setComment(event.target.value)} className="block w-full border rounded p-2" /></div>
        {comment.length > 2000 && <p>Your older text is retained here. Review and shorten it explicitly before resubmission; it has not been truncated automatically.</p>}
        <p>Your first account name and review text will be public if approved. Describe the purchased product; do not include contact, payment or order secrets. Saving changes sends a published review back to moderation.</p>
        <button type="submit" disabled={busy} className="border rounded px-3 py-2">{busy ? "Saving review..." : review ? "Save changes for moderation" : "Submit review for moderation"}</button>
      </fieldset>
    </form>}
    {review && !["LEGACY", "WITHDRAWN"].includes(review.status) && <div><button type="button" disabled={busy} onClick={() => setConfirm(true)} className="underline">Withdraw my review</button>{confirm && <p>Withdraw this review from public display and moderation? Its private history is retained. <button type="button" disabled={busy} onClick={() => void save(true)}>Confirm withdraw review</button> <button type="button" disabled={busy} onClick={() => setConfirm(false)}>Keep review</button></p>}</div>}
  </div>;
}
