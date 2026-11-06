"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { currentReviewScope, fetchReviewJson } from "@/lib/client/review-client";
import { useReviewResource } from "@/hooks/use-review-resource";
import { moderateReviewSchema, REVIEW_STATUSES, type EligibleReviewPage, type OwnedReview, type OwnerReviewPage, type PublicReview, type ReviewProduct, type ReviewStatus } from "@/lib/validations/review";
import { ReviewForm } from "@/components/forms/review-form";
import { RatingSummary } from "@/components/reviews/rating-summary";
type Mode = "customer" | "admin" | "seller";
type ModerationPage = Omit<OwnerReviewPage, "reviews"> & { reviews: (OwnedReview & { displayName: string })[] };
type SellerPage = { ownerId: string; reviews: (PublicReview & { product: ReviewProduct })[]; page: number; total: number; totalPages: number };
export function ReviewsDashboard({ mode }: { mode: Mode }) {
  const { user, loading } = useAuthStore();
  const title = mode === "admin" ? "Purchase review moderation" : mode === "seller" ? "Reviews of my products" : "My purchase reviews";
  if (loading) return <main className="p-8"><h1 className="text-3xl font-bold">{title}</h1><p role="status">Loading your review account...</p></main>;
  if (!user?.isVerified) return <main className="p-8"><h1 className="text-3xl font-bold">{title}</h1><p><Link href="/login" className="underline">Sign in with a verified account</Link> to access reviews.</p></main>;
  if ((mode === "admin" && user.role !== "ADMIN") || (mode === "seller" && (user.role !== "MEMBER" || user.sellerStatus !== "APPROVED"))) return <p role="alert" className="p-8">This review area is not available for your current role or seller status.</p>;
  const key = `${mode}:${user.id}:${user.role}:${user.sellerStatus ?? ""}`;
  return mode === "admin" ? <ModerationDashboard key={key} ownerId={user.id} /> : mode === "seller" ? <SellerDashboard key={key} ownerId={user.id} /> : <CustomerDashboard key={key} ownerId={user.id} />;
}
function Pagination({ page, pages, busy, onPage }: { page: number; pages: number; busy: boolean; onPage: (page: number) => void }) {
  return <nav aria-label="Account review pages" className="flex gap-4"><button type="button" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Previous review records</button><span>Page {page} of {pages}</span><button type="button" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>Next review records</button></nav>;
}
function CustomerDashboard({ ownerId }: { ownerId: string }) {
  const [tab, setTab] = useState<"mine" | "eligible">("mine"), [page, setPage] = useState(1), [editing, setEditing] = useState<string | null>(null);
  const resource = useReviewResource<OwnerReviewPage | EligibleReviewPage>(`/api/user/reviews?tab=${tab}&page=${page}`, ownerId), data = resource.data;
  return <main className="mx-auto max-w-5xl p-6 space-y-5"><h1 className="text-3xl font-bold">My purchase reviews</h1><p>One canonical review per purchased product. Delivered and paid purchases qualify. New or edited feedback waits for moderation; historical unverified duplicates remain read-only.</p>
    <div className="flex flex-wrap gap-4"><button type="button" aria-pressed={tab === "mine"} onClick={() => { setTab("mine"); setPage(1); }}>My review history</button><button type="button" aria-pressed={tab === "eligible"} onClick={() => { setTab("eligible"); setPage(1); }}>Purchases eligible for a review</button><button type="button" onClick={resource.refresh} disabled={resource.loading} className="underline">Reload review list</button></div>
    {resource.loading && <p role="status">Loading review records...</p>}{resource.error && <p role="alert">{resource.error}</p>}
    {data && <><p>{data.total} {"products" in data ? "eligible product(s)" : "private review record(s)"}</p>
      {"products" in data ? <ul className="space-y-4">{data.products.map((product) => <li key={product.id} className="border rounded p-4 space-y-2"><h2 className="font-bold">{product.name}</h2><p>Delivered paid purchase verified for this account.</p><Link className="underline" href={`/products/${encodeURIComponent(product.id)}`}>View purchased product</Link> <button type="button" onClick={() => setEditing(product.id)} className="underline">Write a review for {product.name}</button></li>)}</ul> : <ul className="space-y-4">{data.reviews.map((review) => <li key={review.id} className="border rounded p-4 space-y-2"><h2 className="font-bold">{review.product.name}</h2><p>Status: {review.status}{!review.isCanonical ? " — historical duplicate, read-only" : ""}</p>{review.status === "LEGACY" ? <p>Historical unverified rating: {review.rating}</p> : <RatingSummary rating={review.rating} />}<p className="whitespace-pre-wrap break-words">{review.comment ?? "No written comment supplied."}</p>{review.moderationReason && <p>Moderation feedback: {review.moderationReason}</p>}{review.isCanonical && <button type="button" onClick={() => setEditing(review.product.id)} className="underline">Review or edit {review.product.name}</button>}</li>)}</ul>}
      {data.total === 0 && <p>{"products" in data ? "No additional delivered, paid products are eligible. Existing reviews can be edited from your review history." : "You have not submitted a review. Check eligible purchases to write one."}</p>}
      <Pagination page={data.page} pages={data.totalPages} busy={resource.loading} onPage={setPage} />
    </>}
    {editing && <section aria-label="Selected review editor" className="border-t pt-4"><button type="button" onClick={() => setEditing(null)} className="underline">Close review editor (discard unsaved changes)</button><ReviewForm key={editing} productId={editing} onSaved={resource.refresh} /></section>}
  </main>;
}
function ModerationDashboard({ ownerId }: { ownerId: string }) {
  const [status, setStatus] = useState<ReviewStatus | "ALL">("PENDING"), [page, setPage] = useState(1), [notice, setNotice] = useState("");
  const resource = useReviewResource<ModerationPage>(`/api/admin/reviews?status=${status}&page=${page}`, ownerId);
  return <main className="mx-auto max-w-5xl p-6 space-y-5"><h1 className="text-3xl font-bold">Purchase review moderation</h1><p>Publish or reject submitted purchase feedback using its current revision. Historical unverified rows require owner resubmission. Withdrawn reviews cannot be republished without owner consent.</p>
    <div className="flex gap-4"><label>Review status <select value={status} onChange={(event) => { setStatus(event.target.value as ReviewStatus | "ALL"); setPage(1); }} className="border rounded p-2"><option value="ALL">ALL</option>{REVIEW_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label><button type="button" onClick={resource.refresh} disabled={resource.loading} className="underline">Reload moderation queue</button></div>
    {notice && <p role="status">{notice}</p>}{resource.loading && <p role="status">Loading moderation queue...</p>}{resource.error && <p role="alert">{resource.error}</p>}
    {resource.data && <><p>{resource.data.total} matching review record(s)</p><ul className="space-y-4">{resource.data.reviews.map((review) => <li key={`${review.id}:${review.version}`} className="border rounded p-4 space-y-3"><h2 className="font-bold">{review.product.name}</h2><p>Reviewer: {review.displayName}; status: {review.status}; revision: {review.version}{review.isCanonical ? "" : "; historical duplicate"}</p>{review.status === "LEGACY" ? <p>Unverified historical rating: {review.rating}</p> : <RatingSummary rating={review.rating} />}<p className="whitespace-pre-wrap break-words">{review.comment ?? "No written comment supplied."}</p>{review.moderationReason && <p>Current moderation feedback: {review.moderationReason}</p>}{review.isCanonical && !["LEGACY", "WITHDRAWN"].includes(review.status) ? <ModerationDecision review={review} ownerId={ownerId} onSaved={(updated) => { setNotice(`Review saved as ${updated.status}.`); resource.refresh(); }} /> : <p>This retained review is read-only for moderation.</p>}</li>)}</ul>{!resource.data.total && <p>No review records match this status.</p>}<Pagination page={resource.data.page} pages={resource.data.totalPages} busy={resource.loading} onPage={setPage} /></>}
  </main>;
}
function ModerationDecision({ review, ownerId, onSaved }: { review: OwnedReview; ownerId: string; onSaved: (review: OwnedReview) => void }) {
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const writer = useRef<AbortController | null>(null), writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; writer.current?.abort(); }; }, []);
  async function decide(action: "publish" | "reject") {
    const captured = currentReviewScope(ownerId); if (!captured || writing.current) return;
    const input = moderateReviewSchema.safeParse({ id: review.id, version: review.version, action, ...(action === "reject" ? { reason } : {}) });
    if (!input.success) { setError(input.error.issues[0]?.message ?? "Enter a rejection reason."); return; }
    writer.current = new AbortController(); writing.current = true; setBusy(true); setError("");
    try {
      const result = await fetchReviewJson<{ review: OwnedReview }>("/api/admin/reviews", { method: "POST", body: JSON.stringify(input.data), signal: writer.current.signal }, ownerId);
      if (mounted.current && currentReviewScope(ownerId) === captured) onSaved(result.review);
    } catch (cause) { if (mounted.current && currentReviewScope(ownerId) === captured) setError(cause instanceof Error ? cause.message : "Unable to confirm moderation. Reload this record before retrying."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <fieldset disabled={busy} className="space-y-2"><legend>Moderation decision</legend>{error && <p role="alert">{error}</p>}<label htmlFor={`moderation-reason-${review.id}`}>Rejection reason (required when rejecting)</label><input id={`moderation-reason-${review.id}`} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} className="block border rounded p-2 w-full" /><div className="flex gap-4"><button type="button" aria-label={`Publish review ${review.id}`} onClick={() => void decide("publish")}>Publish review</button><button type="button" aria-label={`Reject review ${review.id}`} onClick={() => void decide("reject")}>Reject review</button></div></fieldset>;
}
function SellerDashboard({ ownerId }: { ownerId: string }) {
  const [page, setPage] = useState(1), resource = useReviewResource<SellerPage>(`/api/member/reviews?page=${page}`, ownerId);
  return <main className="mx-auto max-w-5xl p-6 space-y-5"><h1 className="text-3xl font-bold">Reviews of my products</h1><p>Published, verified purchase feedback for products belonging to your seller account. Review decisions are managed by administrators.</p><button type="button" disabled={resource.loading} onClick={resource.refresh} className="underline">Reload product reviews</button>{resource.loading && <p role="status">Loading seller reviews...</p>}{resource.error && <p role="alert">{resource.error}</p>}
    {resource.data && <><p>{resource.data.total} published review(s)</p><ul className="space-y-4">{resource.data.reviews.map((review) => <li key={review.id} className="border rounded p-4 space-y-2"><h2 className="font-bold">{review.product.name}</h2><p>{review.displayName} — Verified purchase</p><RatingSummary rating={review.rating} /><p className="whitespace-pre-wrap break-words">{review.comment ?? "No written comment supplied."}</p><Link href={`/products/${encodeURIComponent(review.product.id)}#reviews`} className="underline">View product feedback</Link></li>)}</ul>{!resource.data.total && <p>No published purchase reviews for your products.</p>}<Pagination page={resource.data.page} pages={resource.data.totalPages} busy={resource.loading} onPage={setPage} /></>}
  </main>;
}
